/**
 * ================================================================
 * CAPS 출입기록 동기화 - tenter MySQL -> Supabase sa_attendance
 * ================================================================
 * - 세콤 동기화와 같은 날짜 기준 사용
 * - 연차/휴가 정보는 제외
 * - MySQL은 SELECT만 사용
 *
 * 실행:
 *   node sync/caps.js
 * ================================================================
 */

const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

loadSyncEnv();

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS, 10) || 180_000;
const MY_COMPANY_CODE = process.env.MY_COMPANY_CODE || '1600';
const E_GROUP_FILTER = process.env.CAPS_E_GROUP || '08';

const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
  connectTimeout: 15_000,
};

const supabase = createSyncSupabaseClient();

const GATE_MAPPING = {
  '4000': 'CAPS',
  '4004': 'CAPS',
};

function parseATime(aTime) {
  if (!aTime || String(aTime).length < 14) return null;
  const s = String(aTime);
  return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T${s.substring(8, 10)}:${s.substring(10, 12)}:${s.substring(12, 14)}+09:00`;
}

function log(level, msg, detail = '') {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const prefix = { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR' }[level] || 'INFO';
  console.log(`[caps-sync] [${now}] ${prefix} ${msg}${detail ? ` | ${detail}` : ''}`);
}

async function queryMysql(conn, sql, params = []) {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW')) {
    throw new Error('읽기 전용 DB에서는 SELECT만 허용됩니다.');
  }
  const [rows] = await conn.execute(sql, params);
  return rows;
}

function normalizeEmpNo(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith(MY_COMPANY_CODE) && digits.length >= 12) {
    return digits.slice(MY_COMPANY_CODE.length).slice(-8).replace(/^0+/, '') || digits.slice(-8);
  }
  return digits.slice(-8).replace(/^0+/, '') || digits.slice(-8);
}

function buildGateName(row) {
  const parts = [row.e_group, row.e_mode, row.e_type, row.e_result]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '출입';
}

function stripAttendanceSource(rows = []) {
  return rows.map(({ source, ...rest }) => rest);
}

function isMissingAttendanceSourceColumn(error) {
  return String(error?.code || '') === 'PGRST204'
    || String(error?.message || '').toLowerCase().includes('source');
}

async function syncAttendance(conn) {
  const now = new Date();
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 10);
  const fromStr = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, '0')}${String(fromDate.getDate()).padStart(2, '0')}000000`;
  const todayStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

  const rows = await queryMysql(conn, `
    SELECT
      e.I_EMPLOY_NO AS emp_no,
      t.E_IDNO      AS idno,
      t.E_CARD      AS card_no,
      t.E_DATE      AS e_date,
      t.E_TIME      AS e_time,
      t.G_ID        AS gate_code,
      t.E_GROUP     AS e_group,
      t.E_MODE      AS e_mode,
      t.E_TYPE      AS e_type,
      t.E_RESULT    AS e_result
    FROM tenter t
    INNER JOIN hr_employee e ON
      e.I_COMPANY = ?
      AND t.E_IDNO IS NOT NULL
      AND t.E_IDNO <> ''
      AND e.I_COMPANY = LEFT(t.E_IDNO, 4)
      AND e.I_EMPLOY_NO = RIGHT(t.E_IDNO, 8)
    INNER JOIN hr_department d ON
      d.I_COMPANY = ?
      AND d.I_DEPT = e.I_DEPT
    WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1'
      AND t.E_GROUP = ?
      AND t.E_DATE >= ?
      AND t.E_DATE <= ?
    ORDER BY t.E_DATE DESC, t.E_TIME DESC
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE, E_GROUP_FILTER, fromStr.slice(0, 8), todayStr]);

  if (rows.length === 0) return 0;

  const batchSize = 500;
  let total = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((row) => {
      const empNo = normalizeEmpNo(row.emp_no || row.idno);
      const sabun = String(row.idno || '').trim() || `${MY_COMPANY_CODE}${String(empNo).padStart(8, '0')}`;
      const aTime = `${String(row.e_date || '').replace(/\D/g, '').slice(0, 8)}${String(row.e_time || '').replace(/\D/g, '').slice(0, 6).padStart(6, '0')}`;

      return {
        sabun,
        emp_no: empNo || null,
        card_no: row.card_no ? String(row.card_no) : null,
        a_time: aTime,
        log_time: parseATime(aTime),
        eq_code: row.gate_code ? String(row.gate_code) : null,
        gate_name: buildGateName(row) || GATE_MAPPING[String(row.gate_code || '')] || '출입',
        flag1: null,
        event_type: '출입',
        source: 'caps',
        synced_at: new Date().toISOString(),
      };
    });

    let { error } = await supabase
      .from('sa_attendance')
      .upsert(batch, { onConflict: 'sabun,a_time' });

    if (error && isMissingAttendanceSourceColumn(error)) {
      ({ error } = await supabase
        .from('sa_attendance')
        .upsert(stripAttendanceSource(batch), { onConflict: 'sabun,a_time' }));
    }

    if (error) {
      throw new Error(`sa_attendance upsert 실패: ${error.message}`);
    }

    total += batch.length;
  }

  return total;
}

async function runSync() {
  const startedAt = Date.now();
  log('INFO', '동기화 시작');

  let conn = null;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);
    const attCount = await syncAttendance(conn);
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('INFO', `동기화 완료 (${elapsed}s)`, `출입기록 ${attCount}건`);
  } catch (err) {
    log('ERROR', '동기화 실패', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

log('INFO', `CAPS 출입기록 동기화 시작 (${SYNC_INTERVAL_MS / 1000}초 주기, E_GROUP=${E_GROUP_FILTER})`);
runSync();
setInterval(runSync, SYNC_INTERVAL_MS);
