// Separate HR hub sender. Run as its own PM2 process on the HR-connected PC.
const { loadSyncEnv } = require('./loadEnv');
const { createSyncSupabaseClient } = require('./supabaseClient');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const URL = 'https://lzsfdbspvypljsyviakh.supabase.co/rest/v1/rpc/whr_ingest';
const PUBLIC_KEY = 'sb_publishable_pEMmU4vVPtn7EteLHpOByw_nJZiCpQc';
const PAGE = 500;
const INTERVAL = 180000;
const OVERLAP = 5 * 60000;
const SNAPSHOT_INTERVAL = 30 * 60000;
const TABLES = {
  sa_leaves: ['id', 'emp_no,start_date,end_date,leave_code,leave_name,status'],
  sa_employee_schedules: ['emp_no', 'emp_no,schedule_time,schedule_end_time'],
  sa_schedule_overrides: ['id', 'emp_no,work_date,schedule_start,schedule_end'],
  sa_employees: ['emp_no', 'emp_no,email,is_active'],
};

function readKey() {
  if (process.env.HR_HUB_INGEST_KEY) return process.env.HR_HUB_INGEST_KEY.trim();
  if (process.platform !== 'win32') throw new Error('HR_HUB_INGEST_KEY가 설정되지 않았습니다');
  try {
    const script = "$p=Join-Path $env:LOCALAPPDATA 'hecto-sync\\hr-hub.key'; $s=Get-Content -Raw -LiteralPath $p | ConvertTo-SecureString; [System.Net.NetworkCredential]::new('', $s).Password";
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
  } catch { throw new Error('인사연동 키를 읽을 수 없습니다. 서버 사용자 계정의 키 설정을 확인하세요'); }
}

function kstStart(daysAgo, now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  kst.setUTCHours(0, 0, 0, 0);
  kst.setUTCDate(kst.getUTCDate() - daysAgo);
  return new Date(kst.getTime() - 9 * 3600000).toISOString();
}
function compactKst(iso) {
  const d = new Date(new Date(iso).getTime() + 9 * 3600000);
  return d.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}
function rowTime(compact) {
  const s = String(compact || '').replace(/\D/g, '');
  if (!/^\d{14}$/.test(s)) throw new Error('출입시각 형식 오류');
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}+09:00`;
}
function normalize(table, rows) {
  return rows.map((r) => {
    const result = { ...r };
    if (!String(result.emp_no || '').trim()) throw new Error(`${table}: 사번 없는 행`);
    for (const k of ['schedule_time', 'schedule_end_time', 'schedule_start', 'schedule_end']) {
      if (result[k] != null) {
        if (!/^\d{2}:\d{2}(:\d{2})?$/.test(result[k])) throw new Error(`${table}: 근무시각 형식 오류`);
        result[k] = result[k].slice(0, 5);
      }
    }
    return result;
  });
}
async function send(key, table, rows, mode, from, fetchFn = fetch) {
  if (!key) throw new Error('HR_HUB_INGEST_KEY가 설정되지 않았습니다');
  if (!rows.length) throw new Error(`${table}: 빈 데이터 전송 중단`);
  const body = { p_key: key, p_table: table, p_rows: rows, p_mode: mode };
  if (from) body.p_from = from;
  const response = await fetchFn(URL, { method: 'POST', headers: { apikey: PUBLIC_KEY, Authorization: `Bearer ${PUBLIC_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  let data; try { data = await response.json(); } catch { throw new Error(`${table}: 응답 형식 오류 HTTP ${response.status}`); }
  if (!response.ok || data?.ok !== true || data.received !== rows.length || !Number.isInteger(data.written) || data.written < 0 || data.written > data.received) throw new Error(`${table}: 전송 실패 HTTP ${response.status}, ${String(data?.error || '응답 건수 불일치').replaceAll(key, '[redacted]').slice(0, 200)}`);
  return data;
}
async function readAll(db, table, columns, order, since) {
  let records = []; let count = null;
  for (let start = 0; ; start += PAGE) {
    let query = db.from(table).select(columns, { count: 'exact' }).order(order, { ascending: true }).range(start, start + PAGE - 1);
    if (since) query = query.gte('log_time', since);
    const result = await query;
    if (result.error) throw new Error(`${table}: 조회 실패 ${result.error.message}`);
    if (!Number.isInteger(result.count) || (count !== null && count !== result.count)) throw new Error(`${table}: 조회 중 건수 변경`);
    count = result.count; records.push(...result.data);
    if (result.data.length < PAGE) break;
  }
  if (records.length !== count) throw new Error(`${table}: 전체 건수 불일치`);
  return records;
}
async function stableSnapshot(db, table, columns, order, since) {
  const first = await readAll(db, table, columns, order, since);
  if (!first.length) throw new Error(`${table}: 빈 원본은 교체하지 않음`);
  const second = await readAll(db, table, columns, order, since);
  const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
  if (hash(first) !== hash(second)) throw new Error(`${table}: 조회 중 원본 변경, 다음 주기 재시도`);
  return normalize(table, second);
}
async function readAttendance(conn, from, to = new Date().toISOString()) {
  const fromStr = compactKst(from);
  const toStr = compactKst(to);
  const [secom] = await conn.execute(`SELECT e.I_EMPLOY_NO AS emp_no, t.ATime AS a_time FROM t_secom_alarm t INNER JOIN hr_employee e ON e.I_COMPANY = ? AND t.Sabun IS NOT NULL AND t.Sabun <> '' AND e.I_COMPANY = LEFT(t.Sabun, 4) AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8) INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1' AND t.ATime >= ? AND t.ATime <= ?`, ['1600', '1600', fromStr, toStr]);
  const date = fromStr.slice(0, 8), time = fromStr.slice(8), toDate = toStr.slice(0, 8), toTime = toStr.slice(8);
  const [caps] = await conn.execute(`SELECT e.I_EMPLOY_NO AS emp_no, t.E_DATE AS e_date, t.E_TIME AS e_time FROM tenter t INNER JOIN hr_employee e ON e.I_COMPANY = ? AND t.E_IDNO IS NOT NULL AND t.E_IDNO <> '' AND e.I_COMPANY = LEFT(t.E_IDNO, 4) AND e.I_EMPLOY_NO = RIGHT(t.E_IDNO, 8) INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1' AND t.E_GROUP = ? AND (t.E_DATE > ? OR (t.E_DATE = ? AND LPAD(REPLACE(CAST(t.E_TIME AS CHAR), ':', ''), 6, '0') >= ?)) AND (t.E_DATE < ? OR (t.E_DATE = ? AND LPAD(REPLACE(CAST(t.E_TIME AS CHAR), ':', ''), 6, '0') <= ?))`, ['1600', '1600', '08', date, date, time, toDate, toDate, toTime]);
  const combined = secom.map(r => ({ emp_no: String(r.emp_no), log_time: rowTime(r.a_time) })).concat(caps.map(r => {
    const digits = String(r.emp_no).replace(/\D/g, '').slice(-8);
    return { emp_no: digits.replace(/^0+/, '') || digits, log_time: rowTime(String(r.e_date).replace(/\D/g, '').slice(0,8) + String(r.e_time).replace(/\D/g, '').slice(0,6).padStart(6,'0')) };
  }));
  return [...new Map(combined.map(r => [`${r.emp_no}|${r.log_time}`, r])).values()];
}
function checkpointPath() {
  return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'hecto-sync', 'hr-hub-attendance-checkpoint.json');
}
function loadCheckpoint(file) {
  let contents;
  try { contents = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let state;
  try { state = JSON.parse(contents); } catch { throw new Error('출입 체크포인트 파일이 손상됐습니다'); }
  if (state.version !== 1 || typeof state.successThrough !== 'string' || !Number.isFinite(Date.parse(state.successThrough))) throw new Error('출입 체크포인트 형식이 올바르지 않습니다');
  return state.successThrough;
}
function saveCheckpoint(file, successThrough) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, successThrough }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(tmp, file);
  } finally { try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
async function syncIncremental({ read, sendBatch, load, save, now = new Date() }) {
  const to = new Date(Math.floor(now.getTime() / 1000) * 1000);
  if (!Number.isFinite(to.getTime())) throw new Error('서버 시계가 올바르지 않습니다');
  const previous = load();
  if (previous && Date.parse(previous) > to.getTime()) throw new Error('체크포인트가 현재 시각보다 미래입니다. 서버 시계를 확인하세요');
  const from = previous ? new Date(Date.parse(previous) - OVERLAP).toISOString() : kstStart(3, to);
  const rows = await read(from, to.toISOString());
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) written += (await sendBatch(rows.slice(i, i + 500))).written;
  save(to.toISOString());
  return { queried: rows.length, written, from, to: to.toISOString() };
}
async function readSourceWithTimeout(from, to) {
  let conn, timeout;
  try {
    conn = await mysql.createConnection({ host: process.env.MYSQL_HOST, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: process.env.MYSQL_DATABASE, port: Number(process.env.MYSQL_PORT) || 3306, connectTimeout: 15000 });
    return await Promise.race([
      readAttendance(conn, from, to),
      new Promise((_, reject) => { timeout = setTimeout(() => { conn.destroy(); reject(new Error('원본 출입 조회 시간 초과')); }, 60000); }),
    ]);
  } finally { clearTimeout(timeout); if (conn) await conn.end().catch(() => {}); }
}
async function run() {
  loadSyncEnv();
  const key = readKey();
  if (!key) throw new Error('HR_HUB_INGEST_KEY가 설정되지 않았습니다');
  const db = createSyncSupabaseClient();
  let lastSnapshots = 0, lastCorrectionDate = '';
  let attendanceBusy = false, snapshotsBusy = false;
  const failed = (section, e) => console.error(`[인사연동] ${section} 실패: ${e.message}`);
  async function attendanceCycle() {
    if (attendanceBusy) return; attendanceBusy = true;
      try {
        const file = checkpointPath();
        const result = await syncIncremental({ read: readSourceWithTimeout, sendBatch: rows => send(key, 'sa_attendance', rows, 'append'), load: () => loadCheckpoint(file), save: value => saveCheckpoint(file, value) });
        console.log(`[인사연동] 원본 출입 조회 ${result.queried}건 | 신규 저장 ${result.written}건`);
      } catch(e) { failed('원본 출입',e); } finally { attendanceBusy = false; }
  }
  async function snapshotsCycle() {
    if (snapshotsBusy) return; snapshotsBusy = true;
    try {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Seoul' }).format(new Date());
      if (lastCorrectionDate !== today) {
        try {
          const from = kstStart(3);
          const rows = await stableSnapshot(db, 'sa_attendance', 'id,emp_no,log_time', 'id', from);
          const clean = rows.map(({emp_no,log_time}) => ({emp_no,log_time}));
          if (clean.some(r => !r.log_time || !/(Z|[+-]\d\d:\d\d)$/.test(r.log_time))) throw new Error('타임존 없는 출입시각');
          const sourceRows = await readSourceWithTimeout(from, new Date().toISOString());
          const present = new Set(clean.map(r => `${r.emp_no}|${Date.parse(r.log_time)}`));
          const missing = sourceRows.filter(r => !present.has(`${r.emp_no}|${Date.parse(r.log_time)}`));
          if (missing.length) {
            for (let i = 0; i < missing.length; i += 500) await send(key, 'sa_attendance', missing.slice(i, i + 500), 'append');
            throw new Error(`운영 DB에 없는 원본 ${missing.length}건을 인사 DB에 추가 전송하고 전체 보정은 보류`);
          }
          const result = await send(key, 'sa_attendance', clean, 'replace', from);
          lastCorrectionDate = today;
          console.log(`[인사연동] 출입 보정 ${result.written}건`);
        } catch(e) { failed('출입 보정',e); }
      }
      if (Date.now() - lastSnapshots >= SNAPSHOT_INTERVAL) {
        let success = true;
        for (const [table, [order, columns]] of Object.entries(TABLES)) {
          try { const rows = await stableSnapshot(db, table, columns, order); const result = await send(key, table, rows, 'replace'); console.log(`[인사연동] ${table} ${result.written}건`); }
          catch(e) { success = false; failed(table,e); }
        }
        if (success) lastSnapshots = Date.now();
      }
    } catch(e) { failed('스냅샷',e); } finally { snapshotsBusy = false; }
  }
  void attendanceCycle(); void snapshotsCycle();
  setInterval(attendanceCycle, INTERVAL); setInterval(snapshotsCycle, INTERVAL);
}
if (require.main === module) run().catch(e => { console.error(`[인사연동] 시작 실패: ${e.message}`); process.exitCode = 1; });
module.exports = { kstStart, compactKst, rowTime, normalize, send, readAll, stableSnapshot, readAttendance, loadCheckpoint, saveCheckpoint, syncIncremental };
