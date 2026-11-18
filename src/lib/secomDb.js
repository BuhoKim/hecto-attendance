import fs from 'fs';
import path from 'path';
import os from 'os';
import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';

const SETTINGS_FILE = path.join(process.cwd(), 'secom-settings.json');

// ============================================================
// 중요: 이 시스템은 그룹사 공유 DB를 조회(READ-ONLY)합니다.
// DB에 대한 INSERT / UPDATE / DELETE / CREATE / DROP 등
// 데이터 변경 작업은 절대 수행하지 않습니다.
// 우리 회사 코드: I_COMPANY = '1600'
// ============================================================

// Default configurations
const DEFAULT_SETTINGS = {
  appMode: 'local', // 'local' or 'mysql'
  secomDbPath: 'C:\\(주)에스원\\세콤매니저(근태·식당) v9.0.1\\Database',
  syncInterval: 60, // seconds (for UI refresh only, no DB writes)
  nightCheckinGraceHours: 3,
};

// AWS MySQL Connection Settings (READ-ONLY)
const MYSQL_CONFIG = {
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  port: parseInt(process.env.MYSQL_PORT || '3306', 10),
  connectTimeout: 5000
};

// 우리 회사 코드 (그룹사 공유 DB에서 이 코드의 데이터만 조회)
const MY_COMPANY_CODE = '1600';

// 스타팅빌딩 근무 부서 목록 (세콤 시스템 적용 대상)
// 이 부서에 소속된 재직자만 대시보드에 표시됩니다.
// 띄어쓰기 여부 무관하게 매칭 (예: '사업관리1팀' 또는 '사업관리 1팀')
const DEPT_FILTER_SQL = `(
  d.N_DEPT = '플랫폼서비스실'
  OR d.N_DEPT = '사업개발팀'
  OR d.N_DEPT REGEXP '사업관리 ?[123]팀'
)`;

// 단말기 코드 → 명칭 매핑 (이미지 기준 정확한 명칭)
const GATE_MAPPING = {
  // 태광빌딩
  '0001': '태광_11층정문',
  '0002': '태광_11층비상문',
  '0003': '태광_10층정문',
  '0007': '태광_12층정문',
  '0008': '태광_12층비상문',
  '0009': '태광_13층정문',
  '0010': '태광_13층비상문',
  '0011': '태광_10층비상문',
  '0013': '태광_9층정문',
  '0014': '태광_9층비상문',
  '0015': '태광_14층',
  // 큰길빌딩
  '1001': '큰길_1101호',
  '1002': '큰길_3층 자동문',
  '1003': '큰길_3층 후문',
  '1004': '큰길_1102호',
  '1005': '큰길_20층 이노(IN)',
  '1006': '큰길_20층 이노(OUT)',
  '1007': '큰길_20층 파이(IN)',
  '1008': '큰길_20층 파이(OUT)',
  '1009': '큰길_3층 헥토',
  '2001': '큰길_10층 우측',
  '2002': '큰길_10층 좌측',
  '2003': '큰길_5층 연구소',
  '3001': '큰길_5층',
  // 기타
  '4000': '헥토큐앤엠',
  '5001': '채움_외부문',
  '5002': '채움_후문',
  '5003': '채움_화장실',
  '5004': '채움_내부문',
  '5005': '채움_식수1',
  '5006': '채움_식수2',
  '6000': '드림베이',
  '9000': '큰길_10층 이노'
};

// 1. Get/Set Settings
export function getSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (err) {
    console.error('Settings read error:', err);
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings) {
  try {
    const current = getSettings();
    const updated = { ...current, ...settings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8');
    return updated;
  } catch (err) {
    console.error('Settings save error:', err);
    throw err;
  }
}

function generateMockLeaves(yearMonth) {
  const leaves = [];
  const now = new Date();
  
  let targetYear, targetMonthVal;
  if (yearMonth && yearMonth.includes('-')) {
    const parts = yearMonth.split('-');
    targetYear = parseInt(parts[0], 10);
    targetMonthVal = parseInt(parts[1], 10) - 1;
  } else {
    targetYear = now.getFullYear();
    targetMonthVal = now.getMonth();
  }

  const format2Digit = (val) => String(val).padStart(2, '0');
  
  const todayDateStr = `${targetYear}${format2Digit(targetMonthVal + 1)}${format2Digit(now.getDate())}`;
  
  // Employee 1002 - Full-day 연차
  leaves.push({
    empNo: '1002',
    startDate: todayDateStr,
    endDate: todayDateStr,
    leaveCode: '12',
    leaveName: '연차',
    leaveDays: '1.000',
    status: '40'
  });

  // Employee 1003 - 오전 반차
  leaves.push({
    empNo: '1003',
    startDate: todayDateStr,
    endDate: todayDateStr,
    leaveCode: '16',
    leaveName: '4시간휴가 [오전]',
    leaveDays: '0.500',
    status: '40'
  });

  // Employee 1004 - 오후 반차
  leaves.push({
    empNo: '1004',
    startDate: todayDateStr,
    endDate: todayDateStr,
    leaveCode: '17',
    leaveName: '4시간휴가 [오후]',
    leaveDays: '0.500',
    status: '40'
  });

  // Employee 1005 - 2시간휴가
  leaves.push({
    empNo: '1005',
    startDate: todayDateStr,
    endDate: todayDateStr,
    leaveCode: '19',
    leaveName: '2시간휴가A [07-09]',
    leaveDays: '0.250',
    status: '40'
  });

  // Historical leave for employee 1006
  const pastDay = Math.max(1, now.getDate() - 5);
  const pastDateStr = `${targetYear}${format2Digit(targetMonthVal + 1)}${format2Digit(pastDay)}`;
  leaves.push({
    empNo: '1006',
    startDate: pastDateStr,
    endDate: pastDateStr,
    leaveCode: '12',
    leaveName: '연차',
    leaveDays: '1.000',
    status: '40'
  });

  return leaves;
}

function generateMockLogs(yearMonth, mockLeaves = []) {
  const logs = [];
  const now = new Date();
  
  // Parse target year and month
  let targetYear, targetMonthVal;
  if (yearMonth && yearMonth.includes('-')) {
    const parts = yearMonth.split('-');
    targetYear = parseInt(parts[0], 10);
    targetMonthVal = parseInt(parts[1], 10) - 1; // 0-indexed month
  } else {
    targetYear = now.getFullYear();
    targetMonthVal = now.getMonth();
  }

  // Calculate first day and last day of target month
  const firstDay = new Date(targetYear, targetMonthVal, 1);
  const lastDay = new Date(targetYear, targetMonthVal + 1, 0);
  
  // If target month is current month, only generate logs up to today
  const endLimit = (targetYear === now.getFullYear() && targetMonthVal === now.getMonth()) 
    ? now.getDate() 
    : lastDay.getDate();

  const format2Digit = (val) => String(val).padStart(2, '0');

  for (let d = 1; d <= endLimit; d++) {
    const date = new Date(targetYear, targetMonthVal, d);
    
    // Skip weekends (Saturday and Sunday)
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    
    const dateCompact = `${targetYear}${format2Digit(targetMonthVal + 1)}${format2Digit(d)}`;

    MOCK_EMPLOYEES.forEach((emp) => {
      // Find if this employee has an approved leave on this date
      const leave = mockLeaves.find(l => 
        l.empNo === emp.empNo && 
        dateCompact >= l.startDate && 
        dateCompact <= l.endDate
      );

      // If full day leave, skip logs completely
      if (leave && (leave.leaveCode === '12' || leave.leaveDays === '1.000')) {
        return; 
      }

      // 95% attendance rate simulation (if not full-day leave)
      if (Math.random() > 0.05) {
        const inTime = new Date(date);
        
        let hour = 8;
        let min = Math.floor(Math.random() * 60);

        if (leave && leave.leaveCode === '16') {
          // Morning 반차: afternoon check-in at 13:15
          hour = 13;
          min = 15;
        } else if (leave && leave.leaveCode === '19') {
          // 2-hour morning leave: check-in at 09:30
          hour = 9;
          min = 30;
        } else {
          // Normal check-in
          hour = 8 + (Math.random() > 0.8 ? 1 : 0) + (Math.random() > 0.95 ? 1 : 0);
        }

        inTime.setHours(hour, min, Math.floor(Math.random() * 60), 0);
        
        // Format log time to YYYY-MM-DD HH:MM:SS (local time mock)
        const offset = inTime.getTimezoneOffset();
        const localInTime = new Date(inTime.getTime() - (offset * 60 * 1000));
        const logTimeStr = localInTime.toISOString().replace('T', ' ').substring(0, 19);

        // Get custom schedule if any (default to 08:00)
      const settings = getSettings();
      const scheduleTime = (settings.employeeSchedules && settings.employeeSchedules[emp.empNo]) || '08:00';
      const inTimeOnly = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`;
      const morningHalfDayLimit = (() => {
        const [schedH, schedM] = scheduleTime.split(':').map(Number);
        if (schedH >= 10) {
          const limitTime = `${String(schedH + 4).padStart(2, '0')}:${String(schedM).padStart(2, '0')}:59`;
          return limitTime;
        }
        return '13:00:59';
      })();
      const twoHourLeaveLimit = (() => {
        const [schedH, schedM] = scheduleTime.split(':').map(Number);
        if (schedH === 10) return '13:00:59';
        const limitTime = `${String(schedH + 2).padStart(2, '0')}:${String(schedM).padStart(2, '0')}:59`;
        return limitTime;
      })();
      
        // Calculate isLate
        let isLate = inTimeOnly > `${scheduleTime}:59`;
        if (leave && leave.leaveCode === '16') {
          // morning leave deferred limit: base 13:00:59, 10:00 teams => +4 hours
          isLate = inTimeOnly > morningHalfDayLimit;
        } else if (leave && leave.leaveCode === '19') {
          // 2-hour leave deferred limit: schedule + 2 hours, but 10:00 teams => 13:00:59
          isLate = inTimeOnly > twoHourLeaveLimit;
        }
        
        logs.push({
          empNo: emp.empNo,
          name: emp.name,
          dept: emp.dept,
          cardNo: emp.cardNo,
          logTime: logTimeStr,
          gateName: '큰길_10층 이노',
          eventType: '출근',
          isLate: isLate
        });
        
        // Afternoon 반차 (17) -> do not generate clock-out log
        if (leave && leave.leaveCode === '17') {
          return;
        }

        const outTime = new Date(date);
        outTime.setHours(18 + Math.floor(Math.random() * 4), Math.floor(Math.random() * 60), 0, 0);
        
        if (outTime < now || (targetYear !== now.getFullYear() || targetMonthVal !== now.getMonth())) {
          const localOutTime = new Date(outTime.getTime() - (offset * 60 * 1000));
          const logOutTimeStr = localOutTime.toISOString().replace('T', ' ').substring(0, 19);
          logs.push({
            empNo: emp.empNo,
            name: emp.name,
            dept: emp.dept,
            cardNo: emp.cardNo,
            logTime: logOutTimeStr,
            gateName: '큰길_10층 이노',
            eventType: '퇴근',
            isLate: false
          });
        }
      }
    });
  }
  
  return logs.sort((a, b) => b.logTime.localeCompare(a.logTime));
}

// 3. AWS MySQL 읽기 전용 헬퍼 (SELECT만 허용)
// 주의: 그룹사 공유 DB입니다. 데이터 변경(INSERT/UPDATE/DELETE) 절대 금지
async function queryMysql(sql, params = []) {
  // SELECT 문인지 사전 검증 (안전장치)
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('SHOW') && !trimmed.startsWith('DESCRIBE')) {
    throw new Error('[보안] 읽기 전용 DB입니다. SELECT/SHOW/DESCRIBE 쿼리만 허용됩니다.');
  }
  const connection = await mysql.createConnection(MYSQL_CONFIG);
  try {
    const [rows] = await connection.execute(sql, params);
    return rows;
  } finally {
    await connection.end();
  }
}

function formatRawTime(rawTime) {
  if (!rawTime || rawTime.length < 14) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
  const year = rawTime.substring(0, 4);
  const month = rawTime.substring(4, 6);
  const day = rawTime.substring(6, 8);
  const hour = rawTime.substring(8, 10);
  const min = rawTime.substring(10, 12);
  const sec = rawTime.substring(12, 14);
  return `${year}-${month}-${day} ${hour}:${min}:${sec}`;
}

function processMySQLRows(rows) {
  // Flag1 컬럼으로 출근/퇴근 정확히 판별
  // '1' = 출근(입장), '4' = 퇴근(퇴장), 그 외 = 출입
  function classifyByFlag1(flag1, logTime) {
    if (flag1 === '1') return '출근';
    if (flag1 === '4') return '퇴근';
    // Flag1이 없거나 알 수 없는 값이면 시간 기준 추정 (fallback)
    const hour = parseInt((logTime || '').split(' ')[1]?.split(':')[0] || '0', 10);
    return hour < 13 ? '출근' : '퇴근';
  }

  // Format raw fields to frontend format
  const logsWithTime = rows.map(r => ({
    empNo: r.empNo || 'Unknown',
    name: r.name || '방문객',
    dept: r.dept || '부서없음',
    cardNo: r.cardNo || 'Unknown',
    logTime: formatRawTime(r.rawTime),
    gateName: GATE_MAPPING[r.gateCode] || `게이트 (${r.gateCode})`,
    eventType: classifyByFlag1(r.flag1, formatRawTime(r.rawTime))
  }));

  // Sort logs by time descending (newest first)
  return logsWithTime.sort((a, b) => b.logTime.localeCompare(a.logTime));
}

// 5. Safe SQLite Shadow Reader (Fallback)
function readLocalSqlite(dbFolder, yearMonth) {
  const workDbPath = path.join(dbFolder, 'WorkManager.DB');
  const hrDbPath = path.join(dbFolder, 'HRData.DB');
  
  if (!fs.existsSync(workDbPath)) {
    throw new Error(`Database file not found: ${workDbPath}`);
  }

  const tempDir = os.tmpdir();
  const tempWorkPath = path.join(tempDir, `secom_temp_work_${Date.now()}.db`);
  const tempHrPath = path.join(tempDir, `secom_temp_hr_${Date.now()}.db`);
  
  let dbWork = null;
  let dbHr = null;

  try {
    fs.copyFileSync(workDbPath, tempWorkPath);
    if (fs.existsSync(hrDbPath)) {
      fs.copyFileSync(hrDbPath, tempHrPath);
    }
    
    dbWork = new Database(tempWorkPath, { readonly: true });
    
    const tables = dbWork.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    let logTableName = tables.find(t => ['alarm', 'eventlog', 'commute', 'log', 'workhistory'].includes(t.toLowerCase())) || tables[0];
    
    if (!logTableName) {
      throw new Error('No tables found in WorkManager.DB');
    }

    const columns = dbWork.prepare(`PRAGMA table_info(${logTableName})`).all().map(c => c.name);
    
    const colTime = columns.find(c => ['logtime', 'logdate', 'eventtime', 'checktime'].includes(c.toLowerCase())) || columns[0];
    const colEmpNo = columns.find(c => ['empno', 'emp_no', 'sabun', 'memberid'].includes(c.toLowerCase()));
    const colCard = columns.find(c => ['cardno', 'card_no', 'card'].includes(c.toLowerCase()));
    const colGate = columns.find(c => ['gatename', 'readername', 'gate', 'equipname'].includes(c.toLowerCase()));
    const colType = columns.find(c => ['eventtype', 'state', 'status', 'type'].includes(c.toLowerCase()));

    let employees = [];
    if (fs.existsSync(tempHrPath)) {
      try {
        dbHr = new Database(tempHrPath, { readonly: true });
        const hrTables = dbHr.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
        const empTable = hrTables.find(t => ['employee', 'member', 'hr_member', 'users'].includes(t.toLowerCase())) || hrTables[0];
        
        if (empTable) {
          const empColumns = dbHr.prepare(`PRAGMA table_info(${empTable})`).all().map(c => c.name);
          const eColNo = empColumns.find(c => ['Sabun', 'sabun', 'empno', 'emp_no', 'memberid'].includes(c.toLowerCase()));
          const eColName = empColumns.find(c => ['name', 'empname', 'membername'].includes(c.toLowerCase()));
          const eColDept = empColumns.find(c => ['dept', 'deptname', 'department'].includes(c.toLowerCase()));
          const eColCard = empColumns.find(c => ['cardno', 'card_no', 'card'].includes(c.toLowerCase()));
          
          if (eColNo && eColName) {
            employees = dbHr.prepare(`
              SELECT 
                ${eColNo} as empNo, 
                ${eColName} as name, 
                ${eColDept || '""'} as dept,
                ${eColCard || '""'} as cardNo
              FROM ${empTable}
            `).all();
          }
        }
      } catch (hrErr) {
        console.warn('Failed to parse HRData.DB, using empty employee mapping:', hrErr);
      }
    }

    const selectFields = [
      colEmpNo ? `${colEmpNo} as empNo` : 'NULL as empNo',
      colCard ? `${colCard} as cardNo` : 'NULL as cardNo',
      colTime ? `${colTime} as logTime` : 'NULL as logTime',
      colGate ? `${colGate} as gateName` : '"1층 게이트" as gateName',
      colType ? `${colType} as eventType` : '"출입" as eventType'
    ].join(', ');

    const filterQuery = yearMonth 
      ? `WHERE ${colTime} LIKE '${yearMonth}%' OR ${colTime} LIKE '${yearMonth.replace('-', '')}%'`
      : '';

    const rawLogs = dbWork.prepare(`
      SELECT ${selectFields}
      FROM ${logTableName}
      ${filterQuery}
      ORDER BY ${colTime} DESC
      LIMIT 3000
    `).all();

    const empMap = new Map(employees.map(e => [e.empNo || e.cardNo, e]));
    
    return rawLogs.map(log => {
      const emp = empMap.get(log.empNo) || empMap.get(log.cardNo) || {};
      return {
        empNo: log.empNo || emp.empNo || 'Unknown',
        name: emp.name || '방문객',
        dept: emp.dept || '부서없음',
        cardNo: log.cardNo || emp.cardNo || 'Unknown',
        logTime: log.logTime ? log.logTime.replace('T', ' ').substring(0, 19) : new Date().toISOString(),
        gateName: log.gateName || '게이트',
        eventType: log.eventType || '출입'
      };
    });

  } finally {
    if (dbWork) dbWork.close();
    if (dbHr) dbHr.close();
    try {
      if (fs.existsSync(tempWorkPath)) fs.unlinkSync(tempWorkPath);
      if (fs.existsSync(tempHrPath)) fs.unlinkSync(tempHrPath);
    } catch (e) {
      console.warn('Failed to clean up temp DB copies:', e);
    }
  }
}

// 6. 메인 데이터 조회 함수 (MySQL → SQLite → Demo 순으로 Fallback)
// ⚠️ 모든 DB 조회는 I_COMPANY='1600' + 스타팅빌딩 부서 조건으로만 조회합니다.
export async function fetchAttendanceLogs(yearMonth) {
  const settings = getSettings();
  const targetMonth = yearMonth || new Date().toISOString().substring(0, 7); // YYYY-MM
  const targetMonthCompat = targetMonth.replace('-', ''); // YYYYMM

  // 1. AWS MySQL 직접 조회 시도 (READ-ONLY, 세 개 쿼리 실행)
  try {
    // [쿼리 1] 스타팅빌딩 재직 직원 목록 (hr_employee 기준 정답 목록)
    // 이 목록이 "전체 직원" 기준이 됩니다. 로그 유무와 무관합니다.
    const employees = await queryMysql(
      `SELECT
        e.I_EMPLOY_NO AS empNo,
        e.N_EMPLOY_NAME AS name,
        d.N_DEPT AS dept
      FROM hr_employee e
      INNER JOIN hr_department d ON
        d.I_COMPANY = ? AND d.I_DEPT = e.I_DEPT
      WHERE e.I_COMPANY = ?
        AND COALESCE(e.I_RETIRE_YN, '0') <> '1'
        AND ${DEPT_FILTER_SQL}
      ORDER BY d.N_DEPT, e.N_EMPLOY_NAME`,
      [MY_COMPANY_CODE, MY_COMPANY_CODE]
    );

    // [쿼리 2] 해당 직원들의 t_secom_alarm 출입 로그 (스타팅빌딩 부서만 + 해당 월 전체 가져오기)
    // Flag1 컬럼: '1' = 출근(입장), '4' = 퇴근(퇴장), '0' = 기타(방문객 등)
    const logRows = await queryMysql(
      `SELECT
        e.I_EMPLOY_NO AS empNo,
        e.N_EMPLOY_NAME AS name,
        d.N_DEPT AS dept,
        t.CardNo AS cardNo,
        t.ATime AS rawTime,
        CAST(t.EqCode AS CHAR) AS gateCode,
        t.Flag1 AS flag1
      FROM t_secom_alarm t
      INNER JOIN hr_employee e ON
        e.I_COMPANY = ?
        AND t.Sabun IS NOT NULL
        AND t.Sabun <> ''
        AND e.I_COMPANY = LEFT(t.Sabun, 4)
        AND e.I_EMPLOY_NO = RIGHT(t.Sabun, 8)
      INNER JOIN hr_department d ON
        d.I_COMPANY = ?
        AND d.I_DEPT = e.I_DEPT
      WHERE COALESCE(e.I_RETIRE_YN, '0') <> '1'
        AND ${DEPT_FILTER_SQL}
        AND t.ATime LIKE '${targetMonthCompat}%'
      ORDER BY t.ATime DESC`,
      [MY_COMPANY_CODE, MY_COMPANY_CODE]
    );

    // [쿼리 3] 해당 월의 승인 완료된 휴가 목록 (hr_yuncha_use)
    const leaveRows = await queryMysql(
      `SELECT
        y.I_EMPLOY_NO AS empNo,
        y.D_START_DATE AS startDate,
        y.D_END_DATE AS endDate,
        y.I_CODE AS leaveCode,
        COALESCE(c.N_NAME, tc.NAME) AS leaveName,
        CAST(y.O_ANNLEV_CNT AS CHAR) AS leaveDays,
        y.I_STATUS AS status
      FROM hr_yuncha_use y
      INNER JOIN hr_employee e ON
        e.I_COMPANY = y.I_COMPANY
        AND e.I_EMPLOY_NO = y.I_EMPLOY_NO
      INNER JOIN hr_department d ON
        d.I_COMPANY = e.I_COMPANY
        AND d.I_DEPT = e.I_DEPT
      LEFT JOIN hr_diligence_code c ON c.I_CODE = y.I_CODE
      LEFT JOIN tong_code tc ON tc.GUBUN_CODE = 'H0281' AND tc.CODE = y.I_CODE
      WHERE y.I_COMPANY = ?
        AND y.I_STATUS = '40'
        AND COALESCE(TRIM(y.I_STATUS2), '') <> '40'
        AND y.D_START_DATE <= ?
        AND y.D_END_DATE >= ?
        AND ${DEPT_FILTER_SQL}`,
      [MY_COMPANY_CODE, `${targetMonthCompat}31`, `${targetMonthCompat}01`]
    );

    const logs = processMySQLRows(logRows);
    console.log(`[MySQL] 직원 ${employees.length}명, 로그 ${logRows.length}건, 휴가 ${leaveRows.length}건 조회 완료 (I_COMPANY=${MY_COMPANY_CODE})`);
    return { employees, logs, leaves: leaveRows, isDemo: false };

  } catch (err) {
    console.warn(`[MySQL] 연결 실패 (${err.message}). SQLite fallback 시도...`);
  }

  // 2. 로컬 SQLite 조회 시도 (읽기 전용 복사본, 부서 필터 미적용)
  try {
    const logs = readLocalSqlite(settings.secomDbPath);
    return { employees: [], logs, leaves: [], isDemo: false };
  } catch (err) {
    console.warn(`[SQLite] 읽기 실패 (${err.message}). 데모 모드로 전환...`);
    const mockLeaves = generateMockLeaves(targetMonth);
    return {
      employees: [],
      logs: generateMockLogs(targetMonth, mockLeaves),
      leaves: mockLeaves,
      isDemo: true,
      error: `DB 연결 실패. 데모 모드로 표시 중.\n(서버 PC에서 실행 시 실제 데이터가 표시됩니다.)`
    };
  }
}

// ============================================================
// 주의: Cloud Sync (PostgreSQL INSERT) 기능은 제거되었습니다.
// 이유: 그룹사 공유 DB에 대한 데이터 생성/수정/삭제는
//       절대 수행하지 않는 정책을 준수합니다.
// ============================================================

