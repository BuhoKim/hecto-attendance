/** Read-only: list recent SECOM identities with no matching MySQL HR employee. */
const mysql = require('mysql2/promise');
const { loadSyncEnv } = require('./loadEnv');

async function main() {
  loadSyncEnv();
  const days = Number(process.env.SECOM_INSPECT_DAYS || 7);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('SECOM_INSPECT_DAYS must be an integer between 1 and 90');
  }
  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000,
  });
  try {
    const [rows] = await conn.execute(`
      SELECT t.Name AS name, t.Sabun AS sabun, t.CardNo AS card_no,
             COUNT(*) AS records, MAX(t.ATime) AS last_time
      FROM t_secom_alarm t
      WHERE t.ATime >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL ? DAY), '%Y%m%d%H%i%s')
        AND t.ATime <= DATE_FORMAT(NOW(), '%Y%m%d%H%i%s')
        AND NOT EXISTS (
          SELECT 1 FROM hr_employee e
          WHERE e.I_COMPANY = LEFT(t.Sabun, 4)
            AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
        )
      GROUP BY t.Name, t.Sabun, t.CardNo
      ORDER BY last_time DESC
      LIMIT 100
    `, [days]);
    console.log(`Recent ${days} days: unmatched SECOM identities (max 100)`);
    console.table(rows);
    console.log(`Displayed: ${rows.length}; this list can include non-freelancers.`);
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(`SECOM inspection failed: ${error.message}`);
  process.exitCode = 1;
});

