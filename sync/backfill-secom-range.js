/** Reconcile an inclusive date range of SECOM records. Preview unless --apply is given. */
const { buildRoster, prepareRecords } = require('./backfill-attendance-2025');
const COMPANY = '1600';
const PAGE = 500;
const BATCH = 250;

function parseDay(value) {
  const digits = String(value || '').replaceAll('-', '');
  if (!/^\d{8}$/.test(digits)) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.');
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error('유효하지 않은 날짜입니다.');
  return { digits, date };
}

function parseArgs(args) {
  const apply = args.includes('--apply');
  const dates = args.filter((arg) => arg !== '--apply');
  if (dates.length !== 2 || args.length !== 2 + Number(apply)) throw new Error('사용법: node sync/backfill-secom-range.js YYYY-MM-DD YYYY-MM-DD [--apply]');
  const from = parseDay(dates[0]), last = parseDay(dates[1]);
  const duration = last.date - from.date;
  if (duration < 0 || duration > 30 * 86400000) throw new Error('기간은 시작일과 종료일을 포함하여 최대 31일입니다.');
  const next = new Date(last.date.getTime() + 86400000).toISOString().slice(0, 10).replaceAll('-', '');
  return { from: from.digits, to: next, last: last.digits, apply };
}

const key = (r) => JSON.stringify([r.sabun, r.a_time]);

async function readTarget(db, window) {
  const target = new Set();
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.from('sa_attendance').select('sabun,a_time')
      .like('sabun', `${COMPANY}%`).gte('a_time', `${window.from}000000`)
      .lt('a_time', `${window.to}000000`).order('id', { ascending: true }).range(offset, offset + PAGE - 1);
    if (error || !Array.isArray(data)) throw new Error(`운영 DB 조회 실패: ${error?.message || '응답 오류'}`);
    for (const row of data) target.add(key(row));
    if (data.length < PAGE) break;
  }
  return target;
}

async function main(args = process.argv.slice(2)) {
  const window = parseArgs(args);
  require('./loadEnv').loadSyncEnv();
  const mysql = require('mysql2/promise');
  const db = require('./supabaseClient').createSyncSupabaseClient();
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000 });
  try {
    const [rosterRows] = await conn.execute(`SELECT e.I_EMPLOY_NO AS emp_no FROM hr_employee e
      INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
      WHERE e.I_COMPANY = ? AND COALESCE(e.I_RETIRE_YN, '0') <> '1'`, [COMPANY, COMPANY]);
    const roster = buildRoster(rosterRows);
    const [raw] = await conn.execute(`SELECT e.I_EMPLOY_NO AS emp_no, t.Sabun AS sabun,
      t.CardNo AS card_no, t.ATime AS a_time, CAST(t.EqCode AS CHAR) AS eq_code, t.Flag1 AS flag1
      FROM t_secom_alarm t INNER JOIN hr_employee e ON e.I_COMPANY = ?
        AND t.Sabun IS NOT NULL AND t.Sabun <> '' AND e.I_COMPANY = LEFT(t.Sabun, 4)
        AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
      INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
      WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1' AND t.ATime >= ? AND t.ATime < ?
      ORDER BY t.ATime, t.Sabun`, [COMPANY, COMPANY, `${window.from}000000`, `${window.to}000000`]);
    if (!Array.isArray(raw)) throw new Error('원본 조회 오류');
    const prepared = prepareRecords(raw, [], roster, window, new Date().toISOString());
    const target = await readTarget(db, window);
    const missing = prepared.records.filter((row) => !target.has(key(row)));
    console.log(`[세콤 백필] ${window.from}~${window.last} | 원본 ${raw.length}건 | 이미 존재 ${prepared.records.length - missing.length}건 | 추가 대상 ${missing.length}건 | 형식 오류 ${prepared.invalid}건 | 원본 중복 ${prepared.duplicate}건 | 충돌 보류 ${prepared.ambiguous}건`);
    if (!window.apply) { console.log('조회만 했습니다. 적용하려면 같은 명령 뒤에 --apply를 붙이세요.'); return; }
    let inserted = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      const { data, error } = await db.from('sa_attendance').upsert(missing.slice(i, i + BATCH),
        { onConflict: 'sabun,a_time', ignoreDuplicates: true }).select('sabun,a_time');
      if (error || !Array.isArray(data)) throw new Error(`저장 실패: ${error?.message || '응답 오류'}`);
      inserted += data.length;
    }
    console.log(`[세콤 백필] 신규 저장 ${inserted}건 | 중복 또는 동시 저장으로 건너뜀 ${missing.length - inserted}건`);
    const verified = await readTarget(db, window);
    const absent = prepared.records.filter((row) => !verified.has(key(row))).length;
    if (absent) throw new Error(`저장 후 ${absent}건을 확인하지 못했습니다`);
    console.log(`[세콤 백필] 대상 ${prepared.records.length}건 저장 확인`);
    console.log('기존 동기화 체크포인트는 변경하지 않았습니다.');
  } finally { await conn.end(); }
}

if (require.main === module) main().catch((error) => {
  console.error(`[세콤 백필] 중단: ${error.message}. 이미 저장된 건은 유지되며 다시 실행해도 기존 기록을 덮어쓰지 않습니다.`);
  process.exitCode = 1;
});
module.exports = { parseDay, parseArgs, main };

