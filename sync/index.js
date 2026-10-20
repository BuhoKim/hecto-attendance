/**
 * ================================================================
 * 헥토 근태 시스템 - 통합 동기화 데몬 (세콤/캡스/연차/임직원)
 * ================================================================
 * 실행: pm2 start index.js --name hecto-sync
 * ================================================================
 */

const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');
const { syncLeavesToNaverWorks, syncDepartmentCalendars } = require('./naverWorks');
const { getAttendanceWindow, saveAttendanceCheckpoint, formatAttendanceMetrics } = require('./attendanceIncremental');
const { employeeStateFromMysqlRow } = require('./employeeState');

loadSyncEnv();

// ── 설정 ──────────────────────────────────────────────────────────
// 실행 주기: 30분 (1,800,000 ms)
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
// 헥토큐앤엠 전용: 환경변수가 잘못 남아 있어도 다른 법인 자료가 섞이지 않게 고정한다.
const MY_COMPANY_CODE  = '1600';
const CAPS_E_GROUP     = '08';

const MYSQL_CONFIG = {
  host:           process.env.MYSQL_HOST,
  user:           process.env.MYSQL_USER,
  password:       process.env.MYSQL_PASSWORD,
  database:       process.env.MYSQL_DATABASE,
  port:           parseInt(process.env.MYSQL_PORT) || 3306,
  connectTimeout: 15_000,
};

const supabase = createSyncSupabaseClient();

// 세콤 게이트 매핑
const SECOM_GATE_MAPPING = {
  '0001': '태광_11층정문',  '0002': '태광_11층비상문', '0003': '태광_10층정문',
  '0007': '태광_12층정문',  '0008': '태광_12층비상문', '0009': '태광_13층정문',
  '0010': '태광_13층비상문','0011': '태광_10층비상문', '0013': '태광_9층정문',
  '0014': '태광_9층비상문', '0015': '태광_14층',
  '1001': '큰길_1101호',   '1002': '큰길_3층 자동문', '1003': '큰길_3층 후문',
  '1004': '큰길_1102호',   '1005': '큰길_20층 이노(IN)', '1006': '큰길_20층 이노(OUT)',
  '1007': '큰길_20층 파이(IN)', '1008': '큰길_20층 파이(OUT)', '1009': '큰길_3층 헥토',
  '2001': '큰길_10층 우측', '2002': '큰길_10층 좌측', '2003': '큰길_5층 연구소',
  '3001': '큰길_5층',
  '4000': '헥토큐앤엠',
  '5001': '채움_외부문',   '5002': '채움_후문',       '5003': '채움_화장실',
  '5004': '채움_내부문',   '5005': '채움_식수1',      '5006': '채움_식수2',
  '6000': '드림베이',
  '9000': '큰길_10층 이노',
  '1000': '큰길_10층',
};

// 캡스 게이트 매핑
const CAPS_GATE_MAPPING = {
  '4000': 'CAPS',
  '4004': 'CAPS',
};

// ── 유틸 ──────────────────────────────────────────────────────────
function parseATime(aTime) {
  if (!aTime || String(aTime).length < 14) return null;
  const s = String(aTime);
  return `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T${s.substring(8, 10)}:${s.substring(10, 12)}:${s.substring(12, 14)}+09:00`;
}

function formatKstCompact(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});

  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

function flag1ToEventType(flag1) {
  if (flag1 === '1') return '출근';
  if (flag1 === '4') return '퇴근';
  return '출입';
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function pickFirstValue(row, keys = []) {
  for (const key of keys) {
    const value = normalizeText(row?.[key]);
    if (value) return value;
  }
  return '';
}

function extractEmployeeEmail(row) {
  const value = pickFirstValue(row, ['email', 'EMAIL', 'I_EMAIL', 'N_EMAIL', 'EMAIL_ADDRESS', 'email_address']);
  return value.includes('@') ? value : '';
}

function extractEmployeeLoginId(row) {
  return pickFirstValue(row, ['login_id', 'LOGIN_ID', 'user_id', 'USER_ID', 'userid', 'USERID', 'loginid'])
    || (extractEmployeeEmail(row).split('@')[0] || '');
}

function normalizeEmpNo(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith(MY_COMPANY_CODE) && digits.length >= 12) {
    return digits.slice(MY_COMPANY_CODE.length).slice(-8).replace(/^0+/, '') || digits.slice(-8);
  }
  return digits.slice(-8).replace(/^0+/, '') || digits.slice(-8);
}

function buildCapsGateName(row) {
  const parts = [row.e_group, row.e_mode, row.e_type, row.e_result]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(' / ') : '출입';
}

function stripAttendanceSource(rows = []) {
  return rows.map(({ source, ...rest }) => rest);
}

function isMissingAttendanceSourceColumn(error) {
  return String(error?.code || '') === 'PGRST204'
    || String(error?.message || '').toLowerCase().includes('source');
}

function timestamp() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const hour24 = kst.getUTCHours();
  const period = hour24 < 12 ? '오전' : '오후';
  return `${kst.getUTCFullYear()}. ${kst.getUTCMonth() + 1}. ${kst.getUTCDate()}. ${period} ${hour24 % 12 || 12}:${String(kst.getUTCMinutes()).padStart(2, '0')}:${String(kst.getUTCSeconds()).padStart(2, '0')}`;
}

function log(level, msg, detail = '') {
  const prefix = { INFO: '✅', WARN: '⚠️', ERROR: '❌' }[level] || 'ℹ️';
  console.log(`[${timestamp()}] ${prefix} ${msg}${detail ? ' | ' + detail : ''}`);
}

function getKstDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function getKstHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23',
  }).format(new Date()));
}

async function shouldSyncEmployeesToday() {
  if (shouldSyncEmployeesToday.forceOnce) {
    return { due: true, reason: '데몬 시작 후 최초 동기화' };
  }
  if (getKstHour() < 8) return { due: false, reason: '오전 8시 이전' };
  const day = getKstDateKey();
  const from = new Date(`${day}T00:00:00+09:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from('sa_employees')
    .select('emp_no')
    .eq('company_code', MY_COMPANY_CODE)
    .gte('synced_at', from.toISOString())
    .lt('synced_at', to.toISOString())
    .limit(1);
  if (error) throw new Error(`임직원 동기화 상태 조회 실패: ${error.message}`);
  return data?.length
    ? { due: false, reason: '오늘 이미 동기화됨' }
    : { due: true, reason: '미동기화' };
}

async function queryMysql(conn, sql, params = []) {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW')) {
    throw new Error('읽기전용 DB - SELECT만 허용');
  }
  const [rows] = await conn.execute(sql, params);
  return rows;
}

// ── 동기화 함수들 ─────────────────────────────────────────────────

// 1. 임직원 마스터 동기화 (1일 1회만 수행됨)
async function syncEmployees(conn) {
  const rows = await queryMysql(conn, `
    SELECT
      e.*,
      e.I_EMPLOY_NO   AS emp_no,
      e.N_EMPLOY_NAME AS name,
      d.N_DEPT        AS dept
    FROM hr_employee e
    INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
    WHERE e.I_COMPANY = ?
    ORDER BY d.N_DEPT, e.N_EMPLOY_NAME
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE]);

  if (rows.length === 0) return 0;

  const { data: existingEmps, error: fetchErr } = await supabase
    .from('sa_employees')
    .select('emp_no, is_active, status')
    .eq('company_code', MY_COMPANY_CODE);
  if (fetchErr) throw new Error(`기존 직원 조회 실패: ${fetchErr.message}`);
  const existingMap = new Map((existingEmps || []).map(e => [e.emp_no, e]));

  const records = rows.map(r => {
    const existing = existingMap.get(r.emp_no);
    const isRetired = String(r.I_RETIRE_YN ?? '').trim() === '1';
    const { stateCode, stateDate, status: stateStatus } = employeeStateFromMysqlRow(r);
    // 재직상태는 MySQL 인사마스터의 I_STATE_CODE(001 재직/002 휴직/999 퇴직)를 기준으로 동기화한다.
    const isResigned = stateCode === '999' || isRetired;
    return {
      emp_no:         r.emp_no,
      name:           r.name,
      dept:           r.dept,
      email:          extractEmployeeEmail(r) || null,
      login_id:       extractEmployeeLoginId(r) || null,
      company_code:   MY_COMPANY_CODE,
      hr_state_code:  stateCode,
      hr_state_date:  stateDate,
      // 퇴사(999·I_RETIRE_YN=1)는 무조건 비활성, 재직(001)은 무조건 활성으로 상태코드를 우선한다.
      // 휴직(002)이나 상태코드가 없는 직원은 기존 활성 상태를 유지한다.
      is_active:      stateCode === '001' ? true
                    : isResigned ? false
                    : (existing ? existing.is_active : true),
      status:         stateStatus || (isResigned ? 'resigned' : (existing ? (existing.status || 'active') : 'active')),
      synced_at:      new Date().toISOString(),
    };
  });

  const { error } = await supabase
    .from('sa_employees')
    .upsert(records, { onConflict: 'emp_no' });

  if (error) throw new Error(`직원 upsert 실패: ${error.message}`);
  return rows.length;
}

// 2. 세콤 출입기록 동기화 (체크포인트 이후 증분)
async function syncSecomAttendance(conn) {
  const now = new Date();
  const window = await getAttendanceWindow({ supabase, companyCode: MY_COMPANY_CODE, source: 'secom', now });
  const queryStartedAt = Date.now();

  const rows = await queryMysql(conn, `
    SELECT
      e.I_EMPLOY_NO       AS emp_no,
      t.Sabun             AS sabun,
      t.CardNo            AS card_no,
      t.ATime             AS a_time,
      CAST(t.EqCode AS CHAR) AS eq_code,
      t.Flag1             AS flag1
    FROM t_secom_alarm t
    INNER JOIN hr_employee e ON
      e.I_COMPANY = ?
      AND t.Sabun IS NOT NULL AND t.Sabun <> ''
      AND e.I_COMPANY = LEFT(t.Sabun, 4)
      AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
    INNER JOIN hr_department d ON d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
    WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1'
      AND t.ATime >= ? AND t.ATime <= ?
      ORDER BY t.ATime DESC
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE, window.fromStr, window.toStr]);

  const queryBytes = Buffer.byteLength(JSON.stringify(rows || []), 'utf8');
  const queryMs = Date.now() - queryStartedAt;
  const BATCH = 500;
  let total = 0;
  let upsertBytes = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => ({
      sabun:      r.sabun,
      emp_no:     r.emp_no,
      card_no:    r.card_no,
      a_time:     r.a_time,
      log_time:   parseATime(r.a_time),
      eq_code:    r.eq_code,
      gate_name:  SECOM_GATE_MAPPING[r.eq_code] || `게이트(${r.eq_code})`,
      flag1:      r.flag1,
      event_type: flag1ToEventType(r.flag1),
      source:     'secom',
      synced_at:  new Date().toISOString(),
    }));

    let { error } = await supabase
      .from('sa_attendance')
      .upsert(batch, { onConflict: 'sabun,a_time' });

    if (error && isMissingAttendanceSourceColumn(error)) {
      ({ error } = await supabase
        .from('sa_attendance')
        .upsert(stripAttendanceSource(batch), { onConflict: 'sabun,a_time' }));
    }

    if (error) throw new Error(`세콤 출입로그 upsert 실패: ${error.message}`);
    total += batch.length;
    upsertBytes += Buffer.byteLength(JSON.stringify(batch), 'utf8');
  }
  await saveAttendanceCheckpoint({ supabase, companyCode: MY_COMPANY_CODE, source: 'secom', window, rowCount: rows.length, queryBytes, upsertBytes });
  log('INFO', formatAttendanceMetrics({ source: '세콤', rowCount: rows.length, queryBytes, queryMs, upsertBytes, checkpointAt: window.to.toISOString(), origin: window.origin }));
  return total;
}

// 3. 캡스 출입기록 동기화 (체크포인트 이후 증분)
async function syncCapsAttendance(conn) {
  const now = new Date();
  const window = await getAttendanceWindow({ supabase, companyCode: MY_COMPANY_CODE, source: 'caps', now });
  const fromCompact = window.fromStr;
  const toCompact = window.toStr;
  const fromDateStr = fromCompact.slice(0, 8);
  const fromTimeStr = fromCompact.slice(8, 14);
  const toDateStr = toCompact.slice(0, 8);
  const toTimeStr = toCompact.slice(8, 14);
  const queryStartedAt = Date.now();

  const rows = await queryMysql(conn, `
    SELECT
      e.I_EMPLOY_NO AS emp_no,
      t.E_IDNO      AS idno,
      t.E_CARD      AS card_no,
      t.E_DATE      AS e_date,
      t.E_TIME      AS e_time,
      t.G_ID        AS gate_code,
      t.E_GROUP     AS e_group,
      t.E_MODE      AS e_mode,
      t.E_TYPE      AS e_type,
      t.E_RESULT    AS e_result
    FROM tenter t
    INNER JOIN hr_employee e ON
      e.I_COMPANY = ?
      AND t.E_IDNO IS NOT NULL
      AND t.E_IDNO <> ''
      AND e.I_COMPANY = LEFT(t.E_IDNO, 4)
      AND e.I_EMPLOY_NO = RIGHT(t.E_IDNO, 8)
    INNER JOIN hr_department d ON
      d.I_COMPANY = ?
      AND d.I_DEPT = e.I_DEPT
    WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1'
      AND t.E_GROUP = ?
      AND (t.E_DATE > ? OR (t.E_DATE = ? AND LPAD(REPLACE(CAST(t.E_TIME AS CHAR), ':', ''), 6, '0') >= ?))
      AND (t.E_DATE < ? OR (t.E_DATE = ? AND LPAD(REPLACE(CAST(t.E_TIME AS CHAR), ':', ''), 6, '0') <= ?))
    ORDER BY t.E_DATE DESC, t.E_TIME DESC
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE, CAPS_E_GROUP, fromDateStr, fromDateStr, fromTimeStr, toDateStr, toDateStr, toTimeStr]);

  const queryBytes = Buffer.byteLength(JSON.stringify(rows || []), 'utf8');
  const queryMs = Date.now() - queryStartedAt;
  const BATCH = 500;
  let total = 0;
  let upsertBytes = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(row => {
      const empNo = normalizeEmpNo(row.emp_no || row.idno);
      const sabun = String(row.idno || '').trim() || `${MY_COMPANY_CODE}${String(empNo).padStart(8, '0')}`;
      const aTime = `${String(row.e_date || '').replace(/\D/g, '').slice(0, 8)}${String(row.e_time || '').replace(/\D/g, '').slice(0, 6).padStart(6, '0')}`;

      return {
        sabun,
        emp_no:     empNo || null,
        card_no:    row.card_no ? String(row.card_no) : null,
        a_time:     aTime,
        log_time:   parseATime(aTime),
        eq_code:    row.gate_code ? String(row.gate_code) : null,
        gate_name:  buildCapsGateName(row) || CAPS_GATE_MAPPING[String(row.gate_code || '')] || '출입',
        flag1:      null,
        event_type: '출입',
        source:     'caps',
        synced_at:  new Date().toISOString(),
      };
    });

    let { error } = await supabase
      .from('sa_attendance')
      .upsert(batch, { onConflict: 'sabun,a_time' });

    if (error && isMissingAttendanceSourceColumn(error)) {
      ({ error } = await supabase
        .from('sa_attendance')
        .upsert(stripAttendanceSource(batch), { onConflict: 'sabun,a_time' }));
    }

    if (error) throw new Error(`캡스 출입로그 upsert 실패: ${error.message}`);
    total += batch.length;
    upsertBytes += Buffer.byteLength(JSON.stringify(batch), 'utf8');
  }
  await saveAttendanceCheckpoint({ supabase, companyCode: MY_COMPANY_CODE, source: 'caps', window, rowCount: rows.length, queryBytes, upsertBytes });
  log('INFO', formatAttendanceMetrics({ source: '캡스', rowCount: rows.length, queryBytes, queryMs, upsertBytes, checkpointAt: window.to.toISOString(), origin: window.origin }));
  return total;
}

// 4. 연차/휴가 내역 동기화 (최근 1일치)
async function syncLeaves(conn) {
  const now = new Date();
  // 오늘부터 한 달 뒤까지의 승인된 연차를 매 회차 갱신한다.
  const fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const fromStr  = `${fromDate.getFullYear()}${String(fromDate.getMonth() + 1).padStart(2, '0')}${String(fromDate.getDate()).padStart(2, '0')}`;
  const toStr    = `${toDate.getFullYear()}${String(toDate.getMonth() + 1).padStart(2, '0')}${String(toDate.getDate()).padStart(2, '0')}`;

  const rows = await queryMysql(conn, `
    SELECT
      y.I_EMPLOY_NO                  AS emp_no,
      e.N_EMPLOY_NAME                AS emp_name,
      d.N_DEPT                       AS dept,
      y.D_START_DATE                 AS start_date,
      y.D_END_DATE                   AS end_date,
      y.I_CODE                       AS leave_code,
      CAST(y.I_CODE AS CHAR)         AS leave_name,
      CAST(y.O_ANNLEV_CNT AS CHAR)   AS leave_days,
      y.I_STATUS                     AS status
    FROM hr_yuncha_use y
    INNER JOIN hr_employee e ON e.I_COMPANY = y.I_COMPANY AND e.I_EMPLOY_NO = y.I_EMPLOY_NO
    INNER JOIN hr_department d ON d.I_COMPANY = e.I_COMPANY AND d.I_DEPT = e.I_DEPT
    WHERE y.I_COMPANY = ?
      AND y.I_STATUS = '40'
      AND y.D_END_DATE >= ?
      AND y.D_START_DATE <= ?
  `, [MY_COMPANY_CODE, fromStr, toStr]);

  if (rows.length === 0) return 0;

  const records = rows.map(r => ({
    emp_no:     r.emp_no,
    emp_name:   r.emp_name,
    dept:       r.dept,
    start_date: r.start_date,
    end_date:   r.end_date,
    leave_code: r.leave_code,
    leave_name: r.leave_name,
    leave_days: parseFloat(r.leave_days) || 0,
    status:     r.status,
    synced_at:  new Date().toISOString(),
  }));

  const uniqueRecords = [];
  const seen = new Set();
  for (const r of records) {
    const key = `${r.emp_no}_${r.start_date}_${r.leave_code}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueRecords.push(r);
    }
  }

  // DB upsert 시에는 sa_leaves 스키마에 없는 dept 컬럼 제거
  const recordsForDb = uniqueRecords.map(({ dept, ...rest }) => rest);
  const { error } = await supabase
    .from('sa_leaves')
    .upsert(recordsForDb, { onConflict: 'emp_no,start_date,leave_code' });

  if (error) throw new Error(`연차 upsert 실패: ${error.message}`);

  // 네이버웍스 프로필 상태 동기화
  try {
    const empNos = [...new Set(uniqueRecords.map(r => r.emp_no))];
    const { data: emps } = await supabase
      .from('sa_employees')
      .select('emp_no, email, dept')
      .eq('company_code', MY_COMPANY_CODE)
      .in('emp_no', empNos);

    const empMap = new Map((emps || []).map(e => [e.emp_no, e]));
    const leavesWithEmails = uniqueRecords.map(r => {
      const emp = empMap.get(r.emp_no);
      return {
        ...r,
        dept: r.dept || emp?.dept || null,
        email: emp?.email || null,
      };
    });

    await syncLeavesToNaverWorks(leavesWithEmails);
    if (typeof syncDepartmentCalendars === 'function') {
      await syncDepartmentCalendars(supabase);
    }
  } catch (nwErr) {
    console.error('[NaverWorks Sync Error]', nwErr.message);
  }

  return uniqueRecords.length;
}

// ── 메인 루프 ─────────────────────────────────────────────────────
async function runSync() {
  if (runSync.inProgress) {
    log('WARN', '이전 동기화가 아직 진행 중이어서 이번 회차를 건너뜁니다.');
    return;
  }

  runSync.inProgress = true;
  const startedAt = Date.now();
  log('INFO', '동기화 시작');

  let conn = null;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);

    const employeeStatus = await shouldSyncEmployeesToday();
    if (employeeStatus.due) {
      const empCount = await syncEmployees(conn);
      shouldSyncEmployeesToday.forceOnce = false;
      log('INFO', `임직원 정보 동기화 완료 (${empCount}건)`);
    } else {
      log('INFO', `임직원 정보 동기화 건너뜀 (${employeeStatus.reason})`);
    }

    // 출입기록 동기화 (10분 주기 실행, 체크포인트 기준 5분 겹침)
    const secomCount  = await syncSecomAttendance(conn);
    const capsCount   = await syncCapsAttendance(conn);
    const leaveCount  = await syncLeaves(conn);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('INFO', `동기화 완료 (${elapsed}s)`,
      `세콤 ${secomCount}건 | 캡스 ${capsCount}건 | 연차 ${leaveCount}건`);

  } catch (err) {
    log('ERROR', '동기화 실패', err.message);
  } finally {
    if (conn) await conn.end();
    runSync.inProgress = false;
  }
}

// 프로세스 재시작 직후에는 당일 동기화 기록이 있어도 직원 상태를 한 번 재확인한다.
shouldSyncEmployeesToday.forceOnce = true;

function millisecondsUntilNextEightKst() {
  const now = Date.now();
  const kstNow = new Date(now + 9 * 60 * 60 * 1000);
  let target = Date.UTC(
    kstNow.getUTCFullYear(),
    kstNow.getUTCMonth(),
    kstNow.getUTCDate(),
    -1, 0, 0,
  );
  if (target <= now + 1000) target += 24 * 60 * 60 * 1000;
  return target - now;
}

function scheduleDailyEightSync() {
  setTimeout(async () => {
    await runSync();
    scheduleDailyEightSync();
  }, millisecondsUntilNextEightKst());
}

// ── 시작 ──────────────────────────────────────────────────────────
log('INFO', `통합 근태 동기화 데몬 시작 (${SYNC_INTERVAL_MS / 1000 / 60}분 주기)`);
runSync();
setInterval(runSync, SYNC_INTERVAL_MS);
scheduleDailyEightSync();
