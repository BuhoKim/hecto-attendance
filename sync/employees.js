/**
 * 임직원 정보 동기화: MySQL(VPN) → Supabase sa_employees
 *
 * 실행 방법:
 *   node employees.js
 */

const { loadSyncEnv } = require('./loadEnv');
loadSyncEnv();
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

const MY_COMPANY_CODE = process.env.MY_COMPANY_CODE || '1600';

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
  console.log(`[직원 동기화] [${now}] ${prefix} ${msg}${detail ? ' | ' + detail : ''}`);
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

async function runSync() {
  const start = Date.now();
  log('INFO', '임직원 정보 동기화 시작');

  let conn = null;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);

    const [rows] = await conn.execute(`
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

    if (rows.length === 0) {
      log('WARN', '동기화할 직원 정보가 없습니다.');
      return;
    }

    // 기존 직원 정보 조회하여 is_active, status 필드 보존
    const { data: existingEmps, error: fetchErr } = await supabase
      .from('sa_employees')
      .select('emp_no, is_active, status');

    if (fetchErr) {
      throw new Error(`기존 직원 조회 실패: ${fetchErr.message}`);
    }

    const existingMap = new Map((existingEmps || []).map(e => [e.emp_no, e]));

    const records = rows.map(r => {
      const existing = existingMap.get(r.emp_no);
      return {
        emp_no:       r.emp_no,
        name:         r.name,
        dept:         r.dept,
        email:        extractEmployeeEmail(r) || null,
        login_id:     extractEmployeeLoginId(r) || null,
        company_code: MY_COMPANY_CODE,
        is_active:    existing ? existing.is_active : true,
        status:       existing ? (existing.status || 'active') : 'active',
        synced_at:    new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from('sa_employees')
      .upsert(records, { onConflict: 'emp_no' });

    if (error) {
      throw new Error(`직원 upsert 실패: ${error.message}`);
    }

    log('INFO', `임직원 동기화 완료 (${((Date.now() - start) / 1000).toFixed(1)}s)`, `직원 ${records.length}명 완료`);

  } catch (err) {
    log('ERROR', '동기화 실패', err.message || String(err));
    process.exit(1);
  } finally {
    if (conn) {
      await conn.end();
    }
  }
}

runSync();
