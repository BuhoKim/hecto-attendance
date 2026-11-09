// Read-only: compare current source and company DB without printing employee data.
const mysql = require('mysql2/promise');
const { loadSyncEnv } = require('./loadEnv');
const { createSyncSupabaseClient } = require('./supabaseClient');
const { kstStart, readAll, readAttendance } = require('./hrHubSync');

async function main() {
  loadSyncEnv();
  const db = createSyncSupabaseClient();
  const from = kstStart(3);
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, port: Number(process.env.MYSQL_PORT) || 3306, connectTimeout: 15000 });
  try {
    const source = await readAttendance(conn, from);
    const company = await readAll(db, 'sa_attendance', 'id,emp_no,log_time', 'id', from);
    const key = row => `${String(row.emp_no)}|${Date.parse(row.log_time)}`;
    const exact = new Set(company.filter(r => r.emp_no && r.log_time).map(key));
    const canonical = row => `${String(row.emp_no).replace(/^0+/, '')}|${Date.parse(row.log_time)}`;
    const normalized = new Set(company.filter(r => r.emp_no && r.log_time).map(canonical));
    const missing = source.filter(row => !exact.has(key(row)));
    const byDate = {};
    for (const row of missing) {
      const day = row.log_time.slice(0, 10);
      byDate[day] = (byDate[day] || 0) + 1;
    }
    console.log(`조회 시작: ${from}`);
    console.log(`원본 출입 ${source.length}건 | 운영 DB 출입 ${company.length}건`);
    console.log(`사번과 시각이 일치하지 않는 원본 ${missing.length}건`);
    console.log(`그중 사번 앞의 0을 제외하면 일치하는 기록 ${missing.filter(row => normalized.has(canonical(row))).length}건`);
    console.log('불일치 날짜별 건수:', JSON.stringify(byDate));
  } finally { await conn.end(); }
}
main().catch(error => { console.error(`읽기 전용 점검 실패: ${error.message}`); process.exitCode = 1; });
