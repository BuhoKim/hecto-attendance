/**
 * Read-only HR inspection for 윤상혁 (1600 / 20220032).
 * Run from the repository root:
 *   node sync/inspect-yoon-leaves.js --date=2026-10-22
 * No approval filter: includes every source status and every raw leave column.
 */
const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');

const COMPANY = '1600';
const EMP_NO = '20220032';

function parseDate(input = '2026-10-22') {
  if (!/^(\d{8}|\d{4}-\d{2}-\d{2})$/.test(input)) throw new Error('INVALID_DATE');
  const compact = input.replaceAll('-', '');
  const dashed = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const date = new Date(`${dashed}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== dashed) throw new Error('INVALID_DATE');
  return { compact, dashed };
}

async function inspect(conn, date) {
  const [employees] = await conn.execute(
    'SELECT I_EMPLOY_NO, N_EMPLOY_NAME, I_DEPT FROM hr_employee WHERE I_COMPANY = ? AND I_EMPLOY_NO = ?',
    [COMPANY, EMP_NO],
  );
  const [rows] = await conn.execute(`
    SELECT y.*
    FROM hr_yuncha_use y
    WHERE y.I_COMPANY = ? AND y.I_EMPLOY_NO = ?
      AND y.D_START_DATE <= ? AND y.D_END_DATE >= ?
    ORDER BY y.D_START_DATE, y.D_END_DATE, y.I_CODE, y.I_STATUS
  `, [COMPANY, EMP_NO, date.compact, date.compact]);
  return { employees, rows };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('node sync/inspect-yoon-leaves.js --date=2026-10-22 [--json]');
    console.log('기본 날짜: 2026-10-22. 회사 1600 / 사번 20220032. 조회만 수행합니다.');
    return;
  }
  let conn;
  try {
    if (argv.some((arg) => arg !== '--json' && !arg.startsWith('--date='))) throw new Error('INVALID_ARGUMENT');
    const date = parseDate(argv.find((arg) => arg.startsWith('--date='))?.slice(7));
    loadSyncEnv();
    if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) throw new Error('MYSQL_CONFIG_MISSING');
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
      port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000,
      dateStrings: true,
    });
    const { employees, rows } = await inspect(conn, date);
    if (!argv.includes('--json')) {
      console.log(`조회일 ${date.dashed} | 회사 ${COMPANY} | 사번 ${EMP_NO} | ${rows.length}건 (모든 상태)`);
      console.table(employees);
      console.table(rows.map((row) => ({
        I_CODE: row.I_CODE, D_START_DATE: row.D_START_DATE, D_END_DATE: row.D_END_DATE,
        I_STATUS: row.I_STATUS, O_ANNLEV_CNT: row.O_ANNLEV_CNT,
      })));
      console.log('51: 연차 / 17: 오후 반차 / I_STATUS 40: 승인. 그 외 코드·취소 필드는 원본 값으로 확인합니다.');
      console.log('아래는 원본 전체 칼럼입니다. 결과를 보내 주세요.');
    }
    console.log(JSON.stringify({ date: date.dashed, company: COMPANY, empNo: EMP_NO, employees, rows },
      (_key, value) => typeof value === 'bigint' ? String(value) : value, 2));
  } catch (error) {
    // Connection errors can contain connection details; print only a safe code.
    const code = /^[A-Z0-9_]+$/.test(String(error.code || error.message)) ? (error.code || error.message) : 'QUERY_FAILED';
    console.error(`조회 실패: ${code}`);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

if (require.main === module) main();
module.exports = { parseDate, inspect };
