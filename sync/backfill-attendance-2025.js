/**
 * One-off 2025 company attendance backfill. Run only on the HR-connected server:
 *   node sync/backfill-attendance-2025.js
 *
 * Reads SECOM and the same CAPS group as the live sync, in monthly chunks.
 * Existing attendance rows are never overwritten and live checkpoints are untouched.
 */
const COMPANY = '1600';
const CAPS_GROUP = '08';
const BATCH = 250;
const PAGE = 500;

const SECOM_GATES = {
  '0001': '태광_11층정문', '0002': '태광_11층비상문', '0003': '태광_10층정문',
  '0007': '태광_12층정문', '0008': '태광_12층비상문', '0009': '태광_13층정문',
  '0010': '태광_13층비상문', '0011': '태광_10층비상문', '0013': '태광_9층정문',
  '0014': '태광_9층비상문', '0015': '태광_14층',
  '1001': '큰길_1101호', '1002': '큰길_3층 자동문', '1003': '큰길_3층 후문',
  '1004': '큰길_1102호', '1005': '큰길_20층 이노(IN)', '1006': '큰길_20층 이노(OUT)',
  '1007': '큰길_20층 파이(IN)', '1008': '큰길_20층 파이(OUT)', '1009': '큰길_3층 헥토',
  '2001': '큰길_10층 우측', '2002': '큰길_10층 좌측', '2003': '큰길_5층 연구소',
  '3001': '큰길_5층', '4000': '헥토큐앤엠', '5001': '채움_외부문', '5002': '채움_후문',
  '5003': '채움_화장실', '5004': '채움_내부문', '5005': '채움_식수1',
  '5006': '채움_식수2', '6000': '드림베이', '9000': '큰길_10층 이노', '1000': '큰길_10층',
};

const text = (value) => String(value ?? '').trim();
const key = (row) => JSON.stringify([row.sabun, row.a_time]);
const material = (row) => JSON.stringify([row.emp_no, row.card_no, row.eq_code, row.gate_name,
  row.flag1, row.event_type, row.source, new Date(row.log_time).getTime()]);

function monthWindow(month) {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('잘못된 월');
  return {
    month: `2025-${String(month).padStart(2, '0')}`,
    from: `2025${String(month).padStart(2, '0')}01`,
    to: month === 12 ? '20260101' : `2025${String(month + 1).padStart(2, '0')}01`,
  };
}

function logTime(aTime) {
  if (!/^\d{14}$/.test(aTime)) return null;
  const parts = [aTime.slice(0, 4), aTime.slice(4, 6), aTime.slice(6, 8),
    aTime.slice(8, 10), aTime.slice(10, 12), aTime.slice(12, 14)].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const dt = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() + 1 !== month || dt.getUTCDate() !== day
      || dt.getUTCHours() !== hour || dt.getUTCMinutes() !== minute || dt.getUTCSeconds() !== second) return null;
  return `${aTime.slice(0, 4)}-${aTime.slice(4, 6)}-${aTime.slice(6, 8)}T${aTime.slice(8, 10)}:${aTime.slice(10, 12)}:${aTime.slice(12, 14)}+09:00`;
}

function buildRoster(rows) {
  const roster = new Map();
  for (const row of rows) {
    const empNo = text(row.emp_no);
    if (!/^\d{1,8}$/.test(empNo)) throw new Error('HR 사번 형식 확인 필요');
    const padded = empNo.padStart(8, '0');
    if (roster.has(padded) && roster.get(padded) !== empNo) throw new Error('HR 사번 중복 확인 필요');
    roster.set(padded, empNo);
  }
  if (!roster.size) throw new Error('회사 HR 직원 목록이 비어 있어 백필 중단');
  return roster;
}

function makeRecord(row, source, roster, window, stamp) {
  const sabun = text(source === 'secom' ? row.sabun : row.idno);
  if (!/^1600\d{8}$/.test(sabun)) return null;
  let aTime;
  if (source === 'secom') {
    aTime = text(row.a_time);
  } else {
    const day = text(row.e_date);
    const rawTime = text(row.e_time);
    if (rawTime.includes(':') && !/^\d{2}:\d{2}:\d{2}$/.test(rawTime)) return null;
    const time = rawTime.replaceAll(':', '');
    if (!/^\d{8}$/.test(day) || !/^\d{1,6}$/.test(time)) return null;
    aTime = day + time.padStart(6, '0');
  }
  const iso = logTime(aTime);
  if (!iso || aTime < `${window.from}000000` || aTime >= `${window.to}000000`) return null;
  const suffix = sabun.slice(4);
  const empNo = roster.get(suffix) || suffix;
  const code = text(source === 'secom' ? row.eq_code : row.gate_code);
  const flag = source === 'secom' ? text(row.flag1 ?? '0') : null;
  const gate = source === 'secom'
    ? (SECOM_GATES[code] || (code ? `게이트(${code})` : '출입'))
    : [row.e_group, row.e_mode, row.e_type, row.e_result].map(text).filter(Boolean).join(' / ') || '출입';
  return {
    sabun, emp_no: empNo, card_no: text(row.card_no) || null, a_time: aTime,
    log_time: iso, eq_code: code || null, gate_name: gate, flag1: flag,
    event_type: source === 'secom' ? (flag === '1' ? '출근' : flag === '4' ? '퇴근' : '출입') : '출입',
    source, synced_at: stamp,
  };
}

function prepareRecords(secom, caps, roster, window, stamp) {
  const records = new Map();
  const ambiguous = new Set();
  let invalid = 0, duplicate = 0, unmatchedHr = 0;
  for (const [source, rows] of [['secom', secom], ['caps', caps]]) {
    for (const row of rows) {
      const record = makeRecord(row, source, roster, window, stamp);
      if (!record) { invalid++; continue; }
      if (!roster.has(record.sabun.slice(4))) unmatchedHr++;
      const k = key(record);
      if (ambiguous.has(k)) continue;
      const previous = records.get(k);
      if (!previous) records.set(k, record);
      else if (material(previous) === material(record)) duplicate++;
      else { records.delete(k); ambiguous.add(k); }
    }
  }
  return { records: [...records.values()], invalid, duplicate, unmatchedHr, ambiguous: ambiguous.size };
}

async function readTarget(db, window) {
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.from('sa_attendance')
      .select('sabun,a_time,emp_no,card_no,eq_code,gate_name,flag1,event_type,source,log_time')
      .like('sabun', `${COMPANY}%`).gte('a_time', `${window.from}000000`)
      .lt('a_time', `${window.to}000000`).order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error || !Array.isArray(data)) throw new Error(`운영 DB 검증 조회 실패: ${error?.message || '응답 오류'}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function syncMonth(conn, db, roster, window) {
  const [secom] = await conn.execute(`
    SELECT t.Sabun AS sabun, t.CardNo AS card_no, t.ATime AS a_time,
      CAST(t.EqCode AS CHAR) AS eq_code, t.Flag1 AS flag1
    FROM t_secom_alarm t
    WHERE t.ATime >= ? AND t.ATime < ? AND t.Sabun LIKE ?
    ORDER BY t.ATime, t.Sabun
  `, [`${window.from}000000`, `${window.to}000000`, `${COMPANY}%`]);
  const [caps] = await conn.execute(`
    SELECT t.E_IDNO AS idno, t.E_CARD AS card_no, t.E_DATE AS e_date, t.E_TIME AS e_time,
      t.G_ID AS gate_code, t.E_GROUP AS e_group, t.E_MODE AS e_mode,
      t.E_TYPE AS e_type, t.E_RESULT AS e_result
    FROM tenter t
    WHERE t.E_DATE >= ? AND t.E_DATE < ? AND t.E_IDNO LIKE ? AND t.E_GROUP = ?
    ORDER BY t.E_DATE, t.E_TIME, t.E_IDNO
  `, [window.from, window.to, `${COMPANY}%`, CAPS_GROUP]);
  const [otherGroups] = await conn.execute(`
    SELECT COUNT(*) AS n FROM tenter t
    WHERE t.E_DATE >= ? AND t.E_DATE < ? AND t.E_IDNO LIKE ?
      AND (t.E_GROUP IS NULL OR t.E_GROUP <> ?)
  `, [window.from, window.to, `${COMPANY}%`, CAPS_GROUP]);
  if (!Array.isArray(secom) || !Array.isArray(caps) || !Array.isArray(otherGroups) || otherGroups.length !== 1)
    throw new Error('원본 출입자료 응답 오류');

  const prepared = prepareRecords(secom, caps, roster, window, new Date().toISOString());
  // Complete both source reads before any writes for this month.
  let inserted = 0;
  for (let i = 0; i < prepared.records.length; i += BATCH) {
    const { data, error } = await db.from('sa_attendance')
      .upsert(prepared.records.slice(i, i + BATCH), { onConflict: 'sabun,a_time', ignoreDuplicates: true })
      .select('sabun,a_time');
    if (error || !Array.isArray(data)) throw new Error(`운영 DB 입력 실패: ${error?.message || '응답 오류'}`);
    inserted += data.length;
  }
  const target = new Map((await readTarget(db, window)).map((row) => [key(row), row]));
  let missing = 0, different = 0;
  for (const record of prepared.records) {
    const saved = target.get(key(record));
    if (!saved) missing++;
    else if (material(saved) !== material(record)) different++;
  }
  return { month: window.month, secom: secom.length, caps: caps.length, inserted,
    alreadyPresent: prepared.records.length - inserted, checked: prepared.records.length - missing,
    missing, different, invalid: prepared.invalid, ambiguous: prepared.ambiguous,
    duplicate: prepared.duplicate, unmatchedHr: prepared.unmatchedHr,
    capsOtherGroups: Number(otherGroups[0].n) };
}

async function run(conn, db, output = console.log) {
  const [employees] = await conn.execute('SELECT I_EMPLOY_NO AS emp_no FROM hr_employee WHERE I_COMPANY = ?', [COMPANY]);
  const roster = buildRoster(employees);
  const results = [];
  for (let month = 1; month <= 12; month++) {
    const result = await syncMonth(conn, db, roster, monthWindow(month));
    results.push(result);
    output(JSON.stringify(result));
    if (result.missing) throw new Error(`${result.month}: 입력 후 검증되지 않은 기록이 있어 중단`);
  }
  const noSource = results.every((r) => r.secom === 0 && r.caps === 0);
  const hasExceptions = noSource || results.some((r) => r.invalid || r.ambiguous || r.different || r.unmatchedHr || r.capsOtherGroups);
  if (noSource) output('원본에서 대상 기록을 찾지 못했습니다. 보관 기간과 원본을 확인하세요.');
  output(hasExceptions ? '완료: 확인이 필요한 예외가 있습니다.' : '완료: 대상 기록 검증 성공');
  return { results, hasExceptions };
}

async function main() {
  const { loadSyncEnv } = require('./loadEnv');
  loadSyncEnv();
  const mysql = require('mysql2/promise');
  const { createSyncSupabaseClient } = require('./supabaseClient');
  const db = createSyncSupabaseClient(); // Refuses any project other than the company project.
  const conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE,
    port: Number(process.env.MYSQL_PORT || 3306), connectTimeout: 15000 });
  try {
    const { hasExceptions } = await run(conn, db);
    if (hasExceptions) process.exitCode = 2;
  } finally { await conn.end(); }
}

if (require.main === module) main().catch((error) => {
  console.error(`백필 중단: ${error.message}. 완료된 월은 유지되며 재실행해도 덮어쓰지 않습니다.`);
  process.exitCode = 1;
});
module.exports = { monthWindow, logTime, buildRoster, makeRecord, prepareRecords, syncMonth, run };
