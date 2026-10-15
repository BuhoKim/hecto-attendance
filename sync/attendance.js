/**
 * 출입기록 동기화: 로컬 SQLite(WorkManager.DB) → Supabase sa_attendance
 * - MySQL 불필요, VPN 없어도 동작
 * - 3분 주기 실행
 */

const { loadSyncEnv } = require('./loadEnv');
loadSyncEnv();
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const Database = require('better-sqlite3');
const { createSyncSupabaseClient } = require('./supabaseClient');

const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS) || 180_000;
const DB_FOLDER = process.env.SECOM_DB_PATH
  || 'C:\\(주)에스원\\세콤매니저(근태·식당) v9.0.1\\Database';
const MY_COMPANY_CODE = process.env.MY_COMPANY_CODE || '1600';

const supabase = createSyncSupabaseClient();

function log(level, msg, detail = '') {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const prefix = { INFO: '✅', WARN: '⚠️', ERROR: '❌' }[level] || 'ℹ️';
  console.log(`[출입] [${now}] ${prefix} ${msg}${detail ? ' | ' + detail : ''}`);
}

// SQLite 시간 → YYYYMMDDHHMMSS (14자) 정규화
function normalizeATime(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // 이미 14자리 숫자 형태
  if (/^\d{14}$/.test(s)) return s;
  // YYYY-MM-DD HH:MM:SS 또는 YYYY-MM-DDTHH:MM:SS
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (m) return m[1] + m[2] + m[3] + m[4] + m[5] + m[6];
  // YYYYMMDD HHMMSS (공백 구분)
  const m2 = s.match(/^(\d{8})\s(\d{6})$/);
  if (m2) return m2[1] + m2[2];
  return null;
}

// YYYYMMDDHHMMSS → ISO 8601 KST
function aTimeToISO(aTime) {
  if (!aTime || aTime.length < 14) return null;
  return `${aTime.substring(0,4)}-${aTime.substring(4,6)}-${aTime.substring(6,8)}` +
         `T${aTime.substring(8,10)}:${aTime.substring(10,12)}:${aTime.substring(12,14)}+09:00`;
}

// 읽기 충돌 방지: 세콤 소프트웨어가 사용 중인 DB를 임시 복사본으로 읽기
function openCopy(srcPath) {
  const tmp = path.join(os.tmpdir(), `secom_${path.basename(srcPath)}_${Date.now()}.db`);
  fs.copyFileSync(srcPath, tmp);
  return { db: new Database(tmp, { readonly: true }), tmp };
}

async function syncAttendance() {
  const workDbPath = path.join(DB_FOLDER, 'WorkManager.DB');
  const hrDbPath   = path.join(DB_FOLDER, 'HRData.DB');

  if (!fs.existsSync(workDbPath)) {
    throw new Error(`WorkManager.DB 없음: ${workDbPath}`);
  }

  let workCopy = null, hrCopy = null;
  try {
    // ── 1. WorkManager.DB 컬럼 탐색 ───────────────────────────────
    workCopy = openCopy(workDbPath);
    const db = workCopy.db;

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const logTable = tables.find(t =>
      ['alarm','eventlog','commute','log','workhistory','t_secom_alarm'].includes(t.toLowerCase())
    ) || tables[0];

    if (!logTable) throw new Error('WorkManager.DB에 테이블이 없습니다');

    const cols = db.prepare(`PRAGMA table_info(${logTable})`).all().map(c => c.name.toLowerCase());

    const col = (candidates) => candidates.find(c => cols.includes(c)) || null;
    const colTime   = col(['atime','logtime','logdate','eventtime','checktime','e_datetime']);
    const colSabun  = col(['sabun']);
    const colEmpNo  = col(['empno','emp_no','i_employ_no','memberid']);
    const colCard   = col(['cardno','card_no','card','e_card']);
    const colGate   = col(['eqcode','eq_code','gatename','g_id','readername','equipname']);
    const colFlag   = col(['flag1','flag','state','status','type','eventtype']);

    if (!colTime) throw new Error(`시간 컬럼을 찾을 수 없음. 컬럼 목록: ${cols.join(', ')}`);

    log('INFO', `테이블: ${logTable}`, `시간=${colTime} 사번=${colSabun||colEmpNo||'없음'} 카드=${colCard||'없음'}`);

    // ── 2. HRData.DB에서 card → emp_no 매핑 ──────────────────────
    const cardToEmp = new Map(); // card_no → { emp_no, name }
    if (fs.existsSync(hrDbPath)) {
      try {
        hrCopy = openCopy(hrDbPath);
        const hrDb = hrCopy.db;
        const hrTables = hrDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        const empTable = hrTables.find(t =>
          ['employee','member','hr_member','users','person'].includes(t.toLowerCase())
        ) || hrTables[0];

        if (empTable) {
          const eCols = hrDb.prepare(`PRAGMA table_info(${empTable})`).all().map(c => c.name.toLowerCase());
          const eColNo   = eCols.find(c => ['sabun','empno','emp_no','i_employ_no','memberid'].includes(c));
          const eColName = eCols.find(c => ['name','empname','n_employ_name','membername'].includes(c));
          const eColCard = eCols.find(c => ['cardno','card_no','card'].includes(c));

          if (eColNo && eColCard) {
            const emps = hrDb.prepare(`SELECT ${eColNo} as emp_no, ${eColName||'""'} as name, ${eColCard} as card_no FROM ${empTable}`).all();
            emps.forEach(e => {
              if (e.card_no) cardToEmp.set(String(e.card_no), { emp_no: String(e.emp_no), name: e.name });
            });
            log('INFO', `HRData.DB 직원 매핑: ${cardToEmp.size}명`);
          }
        }
      } catch (hrErr) {
        log('WARN', 'HRData.DB 읽기 실패 (무시하고 계속)', hrErr.message);
      }
    }

    // ── 3. 최근 3개월 출입기록 읽기 ──────────────────────────────
    const from = new Date();
    from.setMonth(from.getMonth() - 2);
    from.setDate(1);
    const fromStr = `${from.getFullYear()}${String(from.getMonth()+1).padStart(2,'0')}01000000`;

    const selectFields = [
      colSabun  ? `${logTable}.${colSabun} as sabun`  : 'NULL as sabun',
      colEmpNo  ? `${logTable}.${colEmpNo} as emp_no` : 'NULL as emp_no',
      colCard   ? `${logTable}.${colCard} as card_no`  : 'NULL as card_no',
      `${logTable}.${colTime} as raw_time`,
      colGate   ? `${logTable}.${colGate} as gate_code` : 'NULL as gate_code',
      colFlag   ? `${logTable}.${colFlag} as flag1`     : '"0" as flag1',
    ].join(', ');

    // 시간 필터: YYYYMMDDHHMMSS 또는 ISO 형식 모두 지원
    const whereTime = `(${logTable}.${colTime} >= '${fromStr}' OR ${logTable}.${colTime} >= '${fromStr.substring(0,4)}-${fromStr.substring(4,6)}-${fromStr.substring(6,8)}')`;

    const rows = db.prepare(
      `SELECT ${selectFields} FROM ${logTable} WHERE ${whereTime} ORDER BY ${logTable}.${colTime} DESC`
    ).all();

    log('INFO', `SQLite 읽기 완료: ${rows.length}건`);
    if (rows.length === 0) return 0;

    // ── 4. 레코드 변환 ───────────────────────────────────────────
    const records = [];
    for (const r of rows) {
      const aTime = normalizeATime(r.raw_time);
      if (!aTime) continue;

      const cardNo = r.card_no ? String(r.card_no) : null;
      const mapped = cardNo ? cardToEmp.get(cardNo) : null;

      // sabun 우선순위: DB 직접 값 → card→emp 매핑 구성 → card_no 대체
      let sabun = r.sabun ? String(r.sabun) : null;
      // sabun이 "1600XXXXXXXX" 형태 (16자리)면 뒤 8자리가 emp_no
      let empNo = r.emp_no ? String(r.emp_no) : null;
      if (!empNo && sabun && sabun.startsWith(MY_COMPANY_CODE) && sabun.length >= 12) {
        empNo = sabun.substring(MY_COMPANY_CODE.length).replace(/^0+/, '') || sabun.substring(MY_COMPANY_CODE.length);
      }

      if (!sabun && mapped) {
        empNo  = mapped.emp_no;
        sabun  = MY_COMPANY_CODE + empNo.padStart(8, '0');
      } else if (!sabun && empNo) {
        sabun  = MY_COMPANY_CODE + empNo.padStart(8, '0');
      } else if (!sabun && cardNo) {
        sabun  = cardNo; // 최후 수단: 카드번호를 sabun으로 사용
      }

      if (!sabun) continue; // 식별 불가 레코드 제외

      const flag1 = r.flag1 !== null && r.flag1 !== undefined ? String(r.flag1) : '0';
      const eventType = flag1 === '1' ? '출근' : flag1 === '4' ? '퇴근' : '출입';

      records.push({
        sabun,
        emp_no:     empNo || null,
        card_no:    cardNo,
        a_time:     aTime,
        log_time:   aTimeToISO(aTime),
        eq_code:    r.gate_code ? String(r.gate_code) : null,
        gate_name:  null, // 게이트명은 leaves.js의 GATE_MAPPING 없이 일단 null
        flag1,
        event_type: eventType,
        synced_at:  new Date().toISOString(),
      });
    }

    // ── 5. Supabase upsert (500건씩) ─────────────────────────────
    const BATCH = 500;
    let total = 0;
    for (let i = 0; i < records.length; i += BATCH) {
      const batch = records.slice(i, i + BATCH);
      const { error } = await supabase
        .from('sa_attendance')
        .upsert(batch, { onConflict: 'sabun,a_time' });
      if (error) throw new Error(`sa_attendance upsert 실패: ${error.message}`);
      total += batch.length;
    }
    return total;

  } finally {
    if (workCopy) { workCopy.db.close(); try { fs.unlinkSync(workCopy.tmp); } catch {} }
    if (hrCopy)   { hrCopy.db.close();   try { fs.unlinkSync(hrCopy.tmp); }   catch {} }
  }
}

async function runSync() {
  const start = Date.now();
  log('INFO', '동기화 시작');
  try {
    const count = await syncAttendance();
    log('INFO', `완료 (${((Date.now()-start)/1000).toFixed(1)}s)`, `출입로그 ${count}건`);
  } catch (err) {
    log('ERROR', '동기화 실패', err.message);
  }
}

log('INFO', `출입기록 동기화 시작 (${SYNC_INTERVAL_MS/1000}초 주기)`);
runSync();
setInterval(runSync, SYNC_INTERVAL_MS);
