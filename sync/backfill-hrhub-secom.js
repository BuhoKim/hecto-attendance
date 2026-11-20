// One-off SECOM append to HR Hub; uses the same identity and time mapping as hrHubSync.
const { execFileSync } = require('child_process');
const { rowTime, send } = require('./hrHubSync');

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다');
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('유효하지 않은 날짜입니다');
  return date;
}
function parseArgs(args) {
  const apply = args.includes('--apply');
  const dates = args.filter(a => a !== '--apply');
  if (dates.length !== 2 || args.length !== 2 + Number(apply)) throw new Error('사용법: node sync/backfill-hrhub-secom.js YYYY-MM-DD YYYY-MM-DD [--apply]');
  const from = parseDay(dates[0]), last = parseDay(dates[1]);
  if (last < from || last - from > 30 * 86400000) throw new Error('기간은 최대 31일입니다');
  const compact = d => d.toISOString().slice(0, 10).replaceAll('-', '') + '000000';
  return { from: compact(from), to: compact(new Date(last.getTime() + 86400000)), apply };
}
function readKey() {
  if (process.env.HR_HUB_INGEST_KEY) return process.env.HR_HUB_INGEST_KEY.trim();
  if (process.platform !== 'win32') throw new Error('HR_HUB_INGEST_KEY가 설정되지 않았습니다');
  try {
    const script = "$p=Join-Path $env:LOCALAPPDATA 'hecto-sync\\hr-hub.key'; $s=Get-Content -Raw -LiteralPath $p | ConvertTo-SecureString; [System.Net.NetworkCredential]::new('', $s).Password";
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding:'utf8', timeout:10000, windowsHide:true }).trim();
  } catch { throw new Error('인사연동 키를 읽을 수 없습니다. 기존 동기화와 같은 Windows 계정으로 실행하세요'); }
}
async function readSecom(conn, window) {
  const [raw] = await conn.execute(`SELECT e.I_EMPLOY_NO AS emp_no, t.ATime AS a_time
    FROM t_secom_alarm t INNER JOIN hr_employee e ON e.I_COMPANY = ?
    AND t.Sabun IS NOT NULL AND t.Sabun <> '' AND e.I_COMPANY = LEFT(t.Sabun, 4)
    AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
    INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
    WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1' AND t.ATime >= ? AND t.ATime < ?
    ORDER BY t.ATime, t.Sabun`, ['1600', '1600', window.from, window.to]);
  const rows = raw.map(r => {
    if (!String(r.emp_no || '').trim()) throw new Error('사번 없는 출입기록');
    return { emp_no: String(r.emp_no), log_time: rowTime(r.a_time) };
  });
  return [...new Map(rows.map(r => [`${r.emp_no}|${r.log_time}`, r])).values()];
}
async function appendRows(rows, sendBatch) {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) written += (await sendBatch(rows.slice(i, i + 500))).written;
  return written;
}
async function main(args = process.argv.slice(2)) {
  const window = parseArgs(args);
  require('./loadEnv').loadSyncEnv();
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ host:process.env.MYSQL_HOST, user:process.env.MYSQL_USER, password:process.env.MYSQL_PASSWORD, database:process.env.MYSQL_DATABASE, port:Number(process.env.MYSQL_PORT) || 3306, connectTimeout:15000 });
  try {
    const rows = await readSecom(conn, window);
    console.log(`[HR Hub 세콤 백필] 조회 ${rows.length}건 (중복 제거 후)`);
    if (!window.apply) { console.log('조회만 완료. 전송하려면 --apply를 붙이세요.'); return; }
    if (!rows.length) { console.log('전송할 기록이 없습니다.'); return; }
    const key = readKey();
    const written = await appendRows(rows, batch => send(key, 'sa_attendance', batch, 'append'));
    console.log(`[HR Hub 세콤 백필] 전송 확인 ${rows.length}건 | 신규 저장 ${written}건 | 이미 존재 등 ${rows.length - written}건`);
  } finally { await conn.end(); }
}
if (require.main === module) main().catch(e => { console.error(`[HR Hub 세콤 백필] 중단: ${e.message}. 완료된 묶음은 유지되며 다시 실행할 수 있습니다.`); process.exitCode = 1; });
module.exports = { parseArgs, readSecom, appendRows };

