/**
 * Range-based attendance backfill worker.
 * Reads MySQL attendance logs only for the requested date range and upserts them into Supabase.
 *
 * Default range:
 *   2026-01-01 ~ 2026-03-02
 *
 * Override with:
 *   ATTENDANCE_BACKFILL_FROM=2026-01-01
 *   ATTENDANCE_BACKFILL_TO=2026-03-02
 *
 * Usage:
 *   node backfill-attendance-range.js
 */

const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

loadSyncEnv();

const COMPANY_CODE = process.env.MY_COMPANY_CODE || '1600';
const RANGE_FROM = process.env.ATTENDANCE_BACKFILL_FROM || '2026-01-01';
const RANGE_TO = process.env.ATTENDANCE_BACKFILL_TO || '2026-03-02';

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
  console.log(`[attendance-range] [${now}] ${prefix} ${msg}${detail ? ` | ${detail}` : ''}`);
}

function parseDateInput(value, fallback = '') {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }
  return fallback;
}

function toRangeEndpoints(fromDate, toDate) {
  const from = parseDateInput(fromDate, '2026-01-01');
  const to = parseDateInput(toDate, '2026-03-02');
  if (!from || !to) {
    throw new Error('유효한 날짜 범위가 아닙니다.');
  }

  return {
    fromDate: from,
    toDate: to,
    fromCompact: from.replace(/-/g, ''),
    toCompact: to.replace(/-/g, ''),
    fromTimestamp: `${from}T00:00:00+09:00`,
    toTimestamp: `${to}T23:59:59+09:00`,
  };
}

function parseATime(aTime) {
  if (!aTime || String(aTime).length < 14) return null;
  const s = String(aTime).trim();
  if (!/^\d{14}$/.test(s)) return null;
  return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T${s.substring(8, 10)}:${s.substring(10, 12)}:${s.substring(12, 14)}+09:00`;
}

function flag1ToEventType(flag1) {
  if (String(flag1) === '1') return '출근';
  if (String(flag1) === '4') return '퇴근';
  return '출입';
}

async function queryMysql(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function run() {
  const { fromDate, toDate, fromCompact, fromTimestamp, toTimestamp } = toRangeEndpoints(RANGE_FROM, RANGE_TO);
  log('INFO', '범위 백필 시작', `${fromDate} ~ ${toDate}`);

  const conn = await mysql.createConnection(MYSQL_CONFIG);
  try {
    const { data: employees, error: empErr } = await supabase
      .from('sa_employees')
      .select('emp_no, name, dept');

    if (empErr) {
      throw new Error(`직원 조회 실패: ${empErr.message}`);
    }

    const employeeMap = new Map((employees || []).map((emp) => [String(emp.emp_no || '').trim(), emp]));

    const rows = await queryMysql(conn, `
      SELECT
        e.I_EMPLOY_NO       AS emp_no,
        t.Sabun             AS sabun,
        t.CardNo            AS card_no,
        t.ATime             AS a_time,
        CAST(t.EqCode AS CHAR) AS eq_code,
        t.Flag1             AS flag1
      FROM t_secom_alarm t
      INNER JOIN hr_employee e ON
        e.I_COMPANY = ?
        AND t.Sabun IS NOT NULL AND t.Sabun <> ''
        AND e.I_COMPANY = LEFT(t.Sabun, 4)
        AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
      WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1'
        AND t.ATime >= ?
        AND t.ATime <= ?
      ORDER BY t.ATime DESC
    `, [COMPANY_CODE, fromCompact + '000000', toDate.replace(/-/g, '') + '235959']);

    if (!rows.length) {
      log('INFO', '대상 데이터 없음');
      return;
    }

    const records = [];
    for (const row of rows) {
      const aTime = String(row.a_time || '').trim();
      const iso = parseATime(aTime);
      if (!iso) continue;

      const empNo = String(row.emp_no || '').trim() || String(row.sabun || '').trim().slice(-8);
      const normalizedEmpNo = empNo.replace(/^0+/, '') || empNo;
      const emp = employeeMap.get(normalizedEmpNo) || null;
      const sabun = String(row.sabun || '').trim() || `${COMPANY_CODE}${normalizedEmpNo.padStart(8, '0')}`;

      records.push({
        sabun,
        emp_no: normalizedEmpNo || null,
        card_no: row.card_no ? String(row.card_no) : null,
        a_time: aTime,
        log_time: iso,
        eq_code: row.eq_code ? String(row.eq_code) : null,
        gate_name: emp?.dept ? null : null,
        flag1: String(row.flag1 ?? '0'),
        event_type: flag1ToEventType(row.flag1),
        source: 'mysql-backfill-range',
        synced_at: new Date().toISOString(),
      });
    }

    const batchSize = 500;
    let total = 0;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const { error } = await supabase
        .from('sa_attendance')
        .upsert(batch, { onConflict: 'sabun,a_time' });

      if (error) {
        throw new Error(`sa_attendance upsert 실패: ${error.message}`);
      }
      total += batch.length;
    }

    log('INFO', '범위 백필 완료', `반영 ${total}건`);
  } finally {
    await conn.end();
  }
}

run().catch((err) => {
  log('ERROR', '범위 백필 실패', err.message);
  process.exitCode = 1;
});
