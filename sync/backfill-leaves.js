/**
 * Newly created employee leave backfill worker.
 * ServerPC only: reads MySQL(VPN) and fills Supabase leave rows for queued empNo values.
 */

const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

loadSyncEnv();

const COMPANY_CODE = process.env.MY_COMPANY_CODE || '1600';
const POLL_INTERVAL_MS = parseInt(process.env.LEAVE_BACKFILL_INTERVAL_MS, 10) || 300_000;

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  connectTimeout: 15_000,
};

const supabase = createSyncSupabaseClient();

function log(level, msg, detail = '') {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const prefix = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' }[level] || 'INFO';
  console.log(`[leave-backfill] [${now}] ${prefix} ${msg}${detail ? ` | ${detail}` : ''}`);
}

async function queryMysql(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

function normalizeEmpNo(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return raw;
  if (digits.length >= COMPANY_CODE.length + 8 && digits.startsWith(COMPANY_CODE)) {
    const empNo = digits.slice(COMPANY_CODE.length).replace(/^0+/, '') || digits.slice(COMPANY_CODE.length);
    return empNo.padStart(8, '0');
  }
  if (digits.length <= 8) {
    return digits.replace(/^0+/, '') || digits;
  }
  return digits.slice(-8);
}

async function fetchPendingRequests(limit = 20) {
  const { data, error } = await supabase
    .from('sa_leave_backfill_queue')
    .select('emp_no, requested_at')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`백필 큐 조회 실패: ${error.message}`);
  }

  return data || [];
}

async function updateQueueRow(empNo, patch) {
  const payload = {
    ...patch,
    synced_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('sa_leave_backfill_queue')
    .update(payload)
    .eq('emp_no', empNo);

  if (error) {
    throw new Error(`백필 큐 상태 갱신 실패(${empNo}): ${error.message}`);
  }
}

async function syncLeavesForEmployee(conn, empNo) {
  const rows = await queryMysql(conn, `
    SELECT
      y.I_EMPLOY_NO                AS emp_no,
      e.N_EMPLOY_NAME              AS emp_name,
      y.D_START_DATE               AS start_date,
      y.D_END_DATE                 AS end_date,
      y.I_CODE                     AS leave_code,
      CAST(y.I_CODE AS CHAR)       AS leave_name,
      CAST(y.O_ANNLEV_CNT AS CHAR) AS leave_days,
      y.I_STATUS                   AS status
    FROM hr_yuncha_use y
    INNER JOIN hr_employee e ON e.I_COMPANY = y.I_COMPANY AND e.I_EMPLOY_NO = y.I_EMPLOY_NO
    WHERE y.I_COMPANY = ?
      AND y.I_EMPLOY_NO = ?
      AND y.I_STATUS = '40'
    ORDER BY y.D_START_DATE DESC, y.D_END_DATE DESC, y.I_CODE DESC
  `, [COMPANY_CODE, empNo]);

  if (rows.length === 0) {
    return 0;
  }

  const records = rows.map((row) => ({
    emp_no: row.emp_no,
    emp_name: row.emp_name,
    start_date: row.start_date,
    end_date: row.end_date,
    leave_code: row.leave_code,
    leave_name: row.leave_name,
    leave_days: parseFloat(row.leave_days) || 0,
    status: row.status,
    synced_at: new Date().toISOString(),
  }));

  const uniqueRecords = [];
  const seen = new Set();
  for (const r of records) {
    const key = `${r.emp_no}_${r.start_date}_${r.leave_code}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecords.push(r);
    }
  }

  const { error } = await supabase
    .from('sa_leaves')
    .upsert(uniqueRecords, { onConflict: 'emp_no,start_date,leave_code' });

  if (error) {
    throw new Error(`연차 백필 upsert 실패(${empNo}): ${error.message}`);
  }

  return uniqueRecords.length;
}

async function processQueueOnce(conn) {
  const pendingRequests = await fetchPendingRequests();
  if (pendingRequests.length === 0) {
    return { requested: 0, processed: 0, failed: 0, rows: 0 };
  }

  let processed = 0;
  let failed = 0;
  let rows = 0;

  for (const request of pendingRequests) {
    const empNo = normalizeEmpNo(request.emp_no);
    if (!empNo) {
      failed += 1;
      continue;
    }

    try {
      await updateQueueRow(empNo, {
        status: 'processing',
        processed_at: null,
        last_error: null,
      });

      const imported = await syncLeavesForEmployee(conn, empNo);
      rows += imported;

      await updateQueueRow(empNo, {
        status: 'done',
        processed_at: new Date().toISOString(),
        last_error: null,
      });

      processed += 1;
      log('INFO', `연차 백필 완료`, `${empNo} / ${imported}건`);
    } catch (err) {
      failed += 1;
      try {
        await updateQueueRow(empNo, {
          status: 'failed',
          processed_at: new Date().toISOString(),
          last_error: err.message,
        });
      } catch (updateErr) {
        log('ERROR', `백필 실패 상태 저장 실패`, `${empNo} / ${updateErr.message}`);
      }
      log('ERROR', `연차 백필 실패`, `${empNo} / ${err.message}`);
    }
  }

  return { requested: pendingRequests.length, processed, failed, rows };
}

async function runOnce() {
  let conn = null;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);
    const stats = await processQueueOnce(conn);
    if (stats.requested > 0) {
      log('INFO', '백필 큐 처리 완료', `요청 ${stats.requested}건 / 성공 ${stats.processed}건 / 실패 ${stats.failed}건 / 반영 ${stats.rows}건`);
    }
  } catch (err) {
    log('ERROR', '백필 워커 오류', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

log('INFO', `연차 백필 워커 시작 (${Math.round(POLL_INTERVAL_MS / 1000)}초 주기)`);
runOnce();
setInterval(runOnce, POLL_INTERVAL_MS);
