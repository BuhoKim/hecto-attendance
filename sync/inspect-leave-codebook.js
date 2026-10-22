// Read-only inspection of the two HR code-name sources used by the application.
// node sync/inspect-leave-codebook.js [--code=51 | --all]
const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');

async function inspect(conn, code = '51') {
  const [hr] = await conn.execute(
    'SELECT I_CODE, N_NAME FROM hr_diligence_code' + (code ? ' WHERE I_CODE = ?' : '') + ' ORDER BY I_CODE, N_NAME',
    code ? [code] : [],
  );
  const [common] = await conn.execute(
    "SELECT GUBUN_CODE, CODE, NAME FROM tong_code WHERE GUBUN_CODE = ?" + (code ? ' AND CODE = ?' : '') + ' ORDER BY CODE, NAME',
    code ? ['H0281', code] : ['H0281'],
  );
  return { code: code || 'ALL', hr_diligence_code: hr, tong_code: common };
}

async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('node sync/inspect-leave-codebook.js [--code=51 | --all]');
    console.log('조회 전용. 기본값: 51번. --all: 코드표 전체 이름 조회.');
    return;
  }
  let conn;
  try {
    if (argv.some((arg) => arg !== '--all' && !/^--code=\d+$/.test(arg))
      || (argv.includes('--all') && argv.some((arg) => arg.startsWith('--code=')))) throw new Error('INVALID_ARGUMENT');
    const code = argv.includes('--all') ? null : (argv.find((arg) => arg.startsWith('--code='))?.slice(7) || '51');
    loadSyncEnv();
    if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE) throw new Error('MYSQL_CONFIG_MISSING');
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE, port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000,
    });
    console.log(JSON.stringify(await inspect(conn, code), null, 2));
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(String(error.code || error.message)) ? (error.code || error.message) : 'QUERY_FAILED';
    console.error(`코드표 조회 실패: ${code}`);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

if (require.main === module) main();
module.exports = { inspect };
