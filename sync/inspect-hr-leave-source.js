/** Read-only lookup of one employee's source leave rows, including all statuses. */
const mysql = require('mysql2/promise');
const { loadSyncEnv } = require('./loadEnv');

function date(value) {
  const compact = String(value || '').replaceAll('-', '');
  if (!/^\d{8}$/.test(compact)) throw new Error('Dates must use YYYY-MM-DD or YYYYMMDD');
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error('Invalid date');
  return compact;
}

async function main() {
  const [employee, fromArg, toArg] = process.argv.slice(2);
  if (!employee || !/^\d{1,20}$/.test(employee) || !fromArg || !toArg || process.argv.length !== 5) {
    throw new Error('Usage: node sync/inspect-hr-leave-source.js EMP_NO YYYY-MM-DD YYYY-MM-DD');
  }
  const from = date(fromArg), to = date(toArg);
  if (from > to) throw new Error('Start date must be on or before end date');
  loadSyncEnv();
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000, dateStrings: true,
  });
  try {
    const [rows] = await conn.execute(`
      SELECT D_START_DATE, D_END_DATE, I_CODE, I_STATUS, O_ANNLEV_CNT
      FROM hr_yuncha_use
      WHERE I_COMPANY = ? AND I_EMPLOY_NO = ?
        AND D_START_DATE <= ? AND D_END_DATE >= ?
      ORDER BY D_START_DATE, I_CODE, I_STATUS
    `, ['1600', employee, to, from]);
    console.log(`원본 휴가 조회: ${employee} | ${from} ~ ${to} | ${rows.length}건 (모든 상태)`);
    console.table(rows);
    console.log('I_STATUS 40은 승인 상태입니다. 이 조회는 데이터를 변경하지 않습니다.');
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  const code = error.code && /^[A-Z0-9_]+$/.test(error.code) ? error.code : null;
  const detail = code || (error.message.startsWith('Usage:') || /^(Dates must|Invalid date|Start date)/.test(error.message) ? error.message : 'QUERY_FAILED');
  console.error(`조회 실패: ${detail}`);
  process.exitCode = 1;
});

