/**
 * 연차+직원 동기화: MySQL(VPN) → Supabase sa_leaves + sa_employees
 * - MySQL 접속 실패 시 경고 후 다음 주기에 재시도 (출입기록 sync에는 영향 없음)
 * - 10분 주기 실행
 */

const { loadSyncEnv } = require('./loadEnv');
loadSyncEnv();
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');
const { employeeStateFromMysqlRow } = require('./employeeState');

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

  // 상태코드가 없는 직원은 매 주기 동기화로 관리자가 수정한 상태를 지우지 않도록 기존 상태를 보존한다.
  const { data: existingEmps, error: fetchErr } = await supabase
    .from('SA_employees')
    .select('emp_no, is_active, status');
  if (fetchErr) throw new Error(`기존 직원 조회 실패: ${fetchErr.message}`);
  const existingMap = new Map((existingEmps || []).map(e => [e.emp_no, e]));

  const { error } = await supabase
    .from('SA_employees')
    .upsert(
      rows.map(r => {
        const { stateCode, stateDate, status: stateStatus } = employeeStateFromMysqlRow(r);
        const isResigned = stateCode === '999';
        const existing = existingMap.get(r.emp_no);
        return {
          emp_no:         r.emp_no,
          name:           r.name,
          dept:           r.dept,
          email:          extractEmployeeEmail(r) || null,
          login_id:       extractEmployeeLoginId(r) || null,
          company_code:   MY_COMPANY_CODE,
          hr_state_code:  stateCode,
          hr_state_date:  stateDate,
          is_active:      stateCode === '999' ? false
                        : stateCode === '001' ? true
                        : (existing ? existing.is_active : true),
          status:         stateStatus || (existing ? (existing.status || 'active') : 'active'),
          synced_at:      new Date().toISOString(),
        };
      }),
      { onConflict: 'emp_no' }
    );

  if (error) throw new Error(`직원 upsert 실패: ${error.message}`);
  return rows.length;
}

async function syncLeaves(conn) {
  const { reconcileHrLeaves } = require('../src/lib/leaveReconciliation.cjs');
  const result = await reconcileHrLeaves({ conn, supabase, companyCode: MY_COMPANY_CODE });
  log('INFO', `휴가 대조 완료 (${result.window.from}~${result.window.to}) | 승인 ${result.total}건 | 추가·변경 ${result.changed}건 | 취소 ${result.revoked}건`);
  return result.total;
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
