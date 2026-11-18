/** Read-only inspection of all columns for two source leave dates. */
const mysql = require('mysql2/promise');
const { loadSyncEnv } = require('./loadEnv');

function compactDate(value) {
  const compact = String(value || '').replaceAll('-', '');
  if (!/^\d{8}$/.test(compact)) throw new Error('INVALID_DATE');
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime()) || dt.toISOString().slice(0, 10) !== iso) throw new Error('INVALID_DATE');
  return compact;
}

async function main() {
  const [empNo, date1, date2] = process.argv.slice(2);
  if (!/^\d{1,20}$/.test(empNo || '') || !date1 || !date2 || process.argv.length !== 5) {
    throw new Error('INVALID_ARGUMENT');
  }
  const days = [compactDate(date1), compactDate(date2)];
  loadSyncEnv();
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000, dateStrings: true,
  });
  try {
    const [columns] = await conn.execute(`
      SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION
    `, ['hr_yuncha_use']);
    const [rows] = await conn.execute(`
      SELECT * FROM hr_yuncha_use
      WHERE I_COMPANY = ? AND I_EMPLOY_NO = ? AND D_START_DATE IN (?, ?)
      ORDER BY D_START_DATE, I_CODE
    `, ['1600', empNo, ...days]);
    console.log('hr_yuncha_use 컬럼:');
    console.table(columns);
    console.log(`원본 행 ${rows.length}건 (모든 상태, 모든 컬럼):`);
    console.log(JSON.stringify(rows, (_, value) => typeof value === 'bigint' ? String(value) : value, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  const code = /^[A-Z0-9_]+$/.test(String(error.code || error.message)) ? (error.code || error.message) : 'QUERY_FAILED';
  console.error(`조회 실패: ${code}`);
  if (code === 'INVALID_ARGUMENT' || code === 'INVALID_DATE') console.error('사용법: node sync/inspect-hr-leave-cancellation.js 사번 YYYY-MM-DD YYYY-MM-DD');
  process.exitCode = 1;
});

