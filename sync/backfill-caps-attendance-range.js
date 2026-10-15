/** Backfill CAPS (tenter) attendance records into Supabase. */
const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

loadSyncEnv();
const COMPANY_CODE = process.env.MY_COMPANY_CODE || '1600';
const CAPS_E_GROUP = process.env.CAPS_E_GROUP || '08';
const RANGE_FROM = process.env.ATTENDANCE_BACKFILL_FROM || '';
const RANGE_TO = process.env.ATTENDANCE_BACKFILL_TO || RANGE_FROM;
const mysqlConfig = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: Number(process.env.MYSQL_PORT || 3306),
  connectTimeout: 15000,
};
const supabase = createSyncSupabaseClient();

const compactDate = (value) => {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text.replace(/-/g, '');
  if (/^\d{8}$/.test(text)) return text;
  return '';
};
const makeATime = (date, time) => {
  const d = String(date || '').replace(/\D/g, '').slice(0, 8);
  const t = String(time || '').replace(/\D/g, '').padStart(6, '0').slice(0, 6);
  return d.length === 8 && t.length === 6 ? `${d}${t}` : '';
};
const toIso = (value) => `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}+09:00`;
const normalizeEmpNo = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return (digits.startsWith(COMPANY_CODE) ? digits.slice(COMPANY_CODE.length) : digits).slice(-8).replace(/^0+/, '');
};
const gateName = (row) => [row.e_group, row.e_mode, row.e_type, row.e_result]
  .map((value) => String(value || '').trim()).filter(Boolean).join(' / ') || '출입';

async function run() {
  const from = compactDate(RANGE_FROM);
  const to = compactDate(RANGE_TO);
  if (!from || !to || from > to) throw new Error('ATTENDANCE_BACKFILL_FROM/TO를 YYYY-MM-DD로 입력하세요.');
  console.log(`[caps-backfill] 시작 | ${from} ~ ${to} | E_GROUP=${CAPS_E_GROUP}`);
  const conn = await mysql.createConnection(mysqlConfig);
  try {
    const [rows] = await conn.execute(`
      SELECT e.I_EMPLOY_NO AS emp_no, t.E_IDNO AS idno, t.E_CARD AS card_no,
        t.E_DATE AS e_date, t.E_TIME AS e_time, t.G_ID AS gate_code,
        t.E_GROUP AS e_group, t.E_MODE AS e_mode, t.E_TYPE AS e_type, t.E_RESULT AS e_result
      FROM tenter t
      INNER JOIN hr_employee e ON e.I_COMPANY = ? AND t.E_IDNO IS NOT NULL AND t.E_IDNO <> ''
        AND e.I_COMPANY = LEFT(t.E_IDNO, 4) AND e.I_EMPLOY_NO = RIGHT(t.E_IDNO, 8)
      INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
      WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1' AND t.E_GROUP = ?
        AND t.E_DATE >= ? AND t.E_DATE <= ?
      ORDER BY t.E_DATE, t.E_TIME
    `, [COMPANY_CODE, COMPANY_CODE, CAPS_E_GROUP, from, to]);

    const records = rows.map((row) => {
      const aTime = makeATime(row.e_date, row.e_time);
      const empNo = normalizeEmpNo(row.emp_no || row.idno);
      return {
        sabun: String(row.idno || '').trim() || `${COMPANY_CODE}${String(empNo).padStart(8, '0')}`,
        emp_no: empNo || null,
        card_no: row.card_no ? String(row.card_no) : null,
        a_time: aTime,
        log_time: aTime ? toIso(aTime) : null,
        eq_code: row.gate_code ? String(row.gate_code) : null,
        gate_name: gateName(row),
        flag1: null,
        event_type: '출입',
        source: 'caps-backfill-range',
        synced_at: new Date().toISOString(),
      };
    }).filter((row) => row.a_time && row.emp_no);

    for (let index = 0; index < records.length; index += 500) {
      const { error } = await supabase.from('sa_attendance').upsert(records.slice(index, index + 500), { onConflict: 'sabun,a_time' });
      if (error) throw new Error(`Supabase upsert 실패: ${error.message}`);
    }
    console.log(`[caps-backfill] 완료 | 원본 ${rows.length}건 | 반영 ${records.length}건`);
  } finally {
    await conn.end();
  }
}

run().catch((error) => {
  console.error(`[caps-backfill] 실패 | ${error.message}`);
  process.exitCode = 1;
});
