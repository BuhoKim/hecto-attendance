/**
 * 연차+직원 동기화: MySQL(VPN) → Supabase sa_leaves + sa_employees
 * - MySQL 접속 실패 시 경고 후 다음 주기에 재시도 (출입기록 sync에는 영향 없음)
 * - 10분 주기 실행
 */

const { loadSyncEnv } = require('./loadEnv');
loadSyncEnv();
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

const SYNC_INTERVAL_MS = parseInt(process.env.LEAVES_SYNC_INTERVAL_MS) || 600_000; // 10분
const MY_COMPANY_CODE  = process.env.MY_COMPANY_CODE || '1600';

// .env에서 # 이후가 주석으로 잘리는 문제 방지를 위해 코드 fallback 유지
const MYSQL_CONFIG = {
  host:           process.env.MYSQL_HOST,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  database:       process.env.MYSQL_DATABASE,
  port:           parseInt(process.env.MYSQL_PORT) || 3306,
  connectTimeout: 15_000,
};

const supabase = createSyncSupabaseClient();


function log(level, msg, detail = '') {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const prefix = { INFO: '✅', WARN: '⚠️', ERROR: '❌' }[level] || 'ℹ️';
  console.log(`[연차] [${now}] ${prefix} ${msg}${detail ? ' | ' + detail : ''}`);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function pickFirstValue(row, keys = []) {
  for (const key of keys) {
    const value = normalizeText(row?.[key]);
    if (value) return value;
  }
  return '';
}

function extractEmployeeEmail(row) {
  const value = pickFirstValue(row, ['email', 'EMAIL', 'I_EMAIL', 'N_EMAIL', 'EMAIL_ADDRESS', 'email_address']);
  return value.includes('@') ? value : '';
}

function extractEmployeeLoginId(row) {
  return pickFirstValue(row, ['login_id', 'LOGIN_ID', 'user_id', 'USER_ID', 'userid', 'USERID', 'loginid'])
    || (extractEmployeeEmail(row).split('@')[0] || '');
}

async function query(conn, sql, params = []) {
  const [rows] = await conn.execute(sql, params);
  return rows;
}

async function syncEmployees(conn) {
  const rows = await query(conn, `
    SELECT
      e.*,
      e.I_EMPLOY_NO   AS emp_no,
      e.N_EMPLOY_NAME AS name,
      d.N_DEPT        AS dept
    FROM hr_employee e
    INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
    WHERE e.I_COMPANY = ?
      AND COALESCE(e.I_RETIRE_YN, '0') <> '1'
    ORDER BY d.N_DEPT, e.N_EMPLOY_NAME
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE]);

  if (rows.length === 0) return 0;

  const { error } = await supabase
    .from('SA_employees')
    .upsert(
      rows.map(r => ({
        emp_no:       r.emp_no,
        name:         r.name,
        dept:         r.dept,
        email:        extractEmployeeEmail(r) || null,
        login_id:     extractEmployeeLoginId(r) || null,
        company_code: MY_COMPANY_CODE,
        is_active:    true,
        synced_at:    new Date().toISOString(),
      })),
      { onConflict: 'emp_no' }
    );

  if (error) throw new Error(`직원 upsert 실패: ${error.message}`);
  return rows.length;
}

async function syncLeaves(conn) {
  const now = new Date();
  const fromMonth = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const fromStr   = `${fromMonth.getFullYear()}${String(fromMonth.getMonth()+1).padStart(2,'0')}01`;

  const rows = await query(conn, `
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
    INNER JOIN hr_department d ON d.I_COMPANY = e.I_COMPANY AND d.I_DEPT = e.I_DEPT
    WHERE y.I_COMPANY = ?
      AND y.I_STATUS = '40'
      AND y.D_END_DATE >= ?
  `, [MY_COMPANY_CODE, fromStr]);

  if (rows.length === 0) return 0;

  const records = rows.map(r => ({
    emp_no:     r.emp_no,
    emp_name:   r.emp_name,
    start_date: r.start_date,
    end_date:   r.end_date,
    leave_code: r.leave_code,
    leave_name: r.leave_name,
    leave_days: parseFloat(r.leave_days) || 0,
    status:     r.status,
    synced_at:  new Date().toISOString(),
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
    .from('SA_leaves')
    .upsert(uniqueRecords, { onConflict: 'emp_no,start_date,leave_code' });

  if (error) throw new Error(`연차 upsert 실패: ${error.message}`);
  return uniqueRecords.length;
}

async function runSync() {
  const start = Date.now();
  log('INFO', '동기화 시작');

  let conn = null;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);

    const empCount   = await syncEmployees(conn);
    const leaveCount = await syncLeaves(conn);

    log('INFO', `완료 (${((Date.now()-start)/1000).toFixed(1)}s)`,
      `직원 ${empCount}명 | 연차 ${leaveCount}건`);

  } catch (err) {
    // MySQL 실패는 경고만 — 출입기록 sync(attendance.js)와 독립
    log('WARN', 'MySQL 연결 실패, 다음 주기에 재시도', err.message);
  } finally {
    if (conn) await conn.end();
  }
}

log('INFO', `연차+직원 동기화 시작 (${SYNC_INTERVAL_MS/1000}초 주기)`);
runSync();
setInterval(runSync, SYNC_INTERVAL_MS);
