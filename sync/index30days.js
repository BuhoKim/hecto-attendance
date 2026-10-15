/**
 * 30일 전부터 현재 시점까지의 세콤/캡스 출입기록을 가져와서 Supabase에 적재하는 일회성/수동 동기화 스크립트.
 * 파일명: index30days.js
 * 실행 방법 (저장소 루트): node sync/index30days.js
 * 실행 방법 (sync 폴더): npm run index30days
 * 사번 매칭을 수정한 후 실행하세요. 과거 원본의 사번이 잘못되어 있으면 매칭에서 제외됩니다.
 * 기존 기록은 sabun,a_time 기준으로 갱신하며 실시간 동기화 체크포인트는 변경하지 않습니다.
 */

const { loadSyncEnv } = require('./loadEnv');
const mysql = require('mysql2/promise');
const { createSyncSupabaseClient } = require('./supabaseClient');

loadSyncEnv();

const MY_COMPANY_CODE  = process.env.MY_COMPANY_CODE || '1600';
const CAPS_E_GROUP     = process.env.CAPS_E_GROUP || '08';

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

function flag1ToEventType(flag1) {
  if (flag1 === '1') return '출근';
  if (flag1 === '4') return '퇴근';
  return '출입';
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

function log(level, msg, detail = '') {
  const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const prefix = { INFO: '✅', WARN: '⚠️', ERROR: '❌' }[level] || 'ℹ️';
  console.log(`[${now}] ${prefix} ${msg}${detail ? ' | ' + detail : ''}`);
}

async function queryMysql(conn, sql, params = []) {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW')) {
    throw new Error('읽기전용 DB - SELECT만 허용');
  }
  const [rows] = await conn.execute(sql, params);
  return rows;
}

function formatKstBoundary(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace(/[-T:]/g, '');
}

function getThirtyDayWindow(now = new Date()) {
  return {
    from: formatKstBoundary(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
    to: formatKstBoundary(now),
  };
}

// ── 동기화 함수들 ─────────────────────────────────────────────────

// 세콤 출입기록 동기화 (최근 30일치)
async function syncSecomAttendance(conn, window) {
  const fromStr = window.from;
  const toStr = window.to;
  log('INFO', `세콤 동기화 범위 (KST): ${fromStr} ~ ${toStr}`);

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
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE, fromStr, toStr]);

  if (rows.length === 0) return 0;

  const BATCH = 500;
  let total = 0;
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
  }
  return total;
}

// 캡스 출입기록 동기화 (최근 30일치)
async function syncCapsAttendance(conn, window) {
  const fromDateStr = window.from.slice(0, 8);
  const fromTimeStr = window.from.slice(8);
  const toDateStr = window.to.slice(0, 8);
  const toTimeStr = window.to.slice(8);
  log('INFO', `캡스 동기화 범위 (KST): ${window.from} ~ ${window.to}`);

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
      AND (
        t.E_DATE > ?
        OR (t.E_DATE = ? AND LPAD(REPLACE(CAST(t.E_TIME AS CHAR), ':', ''), 6, '0') >= ?)
      )
      AND (
        t.E_DATE < ?
        OR (t.E_DATE = ? AND LPAD(REPLACE(CAST(t.E_TIME AS CHAR), ':', ''), 6, '0') <= ?)
      )
    ORDER BY t.E_DATE DESC, t.E_TIME DESC
  `, [MY_COMPANY_CODE, MY_COMPANY_CODE, CAPS_E_GROUP, fromDateStr, fromDateStr, fromTimeStr, toDateStr, toDateStr, toTimeStr]);

  if (rows.length === 0) return 0;

  const BATCH = 500;
  let total = 0;
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
  }
  return total;
}

// ── 메인 실행 함수 ────────────────────────────────────────────────
async function main() {
  const startedAt = Date.now();
  const window = getThirtyDayWindow();
  log('INFO', '30일간의 출입기록 동기화 작업 시작');

  let conn = null;
  try {
    conn = await mysql.createConnection(MYSQL_CONFIG);

    const secomCount = await syncSecomAttendance(conn, window);
    log('INFO', `세콤 동기화 완료: ${secomCount}건`);

    const capsCount = await syncCapsAttendance(conn, window);
    log('INFO', `캡스 동기화 완료: ${capsCount}건`);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    log('INFO', `30일간의 동기화 완료 (${elapsed}s) | 세콤 ${secomCount}건 | 캡스 ${capsCount}건`);

  } catch (err) {
    log('ERROR', '30일간의 동기화 작업 실패', err.message);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end();
  }
}

if (require.main === module) main();

module.exports = { getThirtyDayWindow, syncSecomAttendance, syncCapsAttendance };
