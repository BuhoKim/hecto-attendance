process.env.TZ = 'Asia/Seoul';
import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabaseClient';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import { isLeaderPosition } from '@/lib/roleUtils';
import { fetchAttendanceLogs, getSettings, fetchOvertimeSettings, fetchEmployeeSchedules, fetchEmployeeOvertimeRounds } from '@/lib/supabaseDb';
import { getLeaveMeta } from '@/lib/leaveRules';
import { isSpecialDayTeamDept } from '@/lib/nightScheduleRules';
import { getKstDateKey, shiftKstDateKey } from '@/lib/kstDate';
import { isManagedAttendanceDept, normalizeDeptLoose, normalizeEmpNoKey } from '@/lib/dashboardUtils';
import {
  TWO_HOUR_LEAVE_CODES,
  EARLY_MORNING_TARGET_DEPTS,
  toMinutes,
  normalizeTime,
  getShiftedLimit,
  getMorningHalfDayLimit,
  getTwoHourLeaveLimit,
  getTwoHourLeaveEndTime,
  getTwoHourLeaveDisplayLabel,
  isAfternoonHalfLeave,
  getLateCheckinLimit,
  isOvernightSchedule,
  isEarlyMorningOvertimeTarget,
  getEarlyMorningCarryoverCutoffMinutes,
} from '@/lib/attendanceCalculations';
import {
  buildEmployeeScheduleMap,
  buildScheduleOverrideMap,
  buildTeamSchedulePatternMap,
  resolveSchedulePairForDate,
} from '@/lib/scheduleResolver';

export const dynamic = 'force-dynamic';

const getKstMonthKey = () => {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
};

import { attendanceCache } from '@/lib/attendanceCache';

export async function GET(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || undefined; // YYYY-MM
    const dashboardOnly = !month || searchParams.get('dashboardOnly') === 'true';
    const excludeLogs = searchParams.get('excludeLogs') === 'true';
    const requestedEmpNo = searchParams.get('empNo');
    const requested = requestedEmpNo === null ? null : [...new Set(
      requestedEmpNo.split(',').map((value) => value.trim()).filter(Boolean)
    )];
    if (requested && requested.length === 0) {
      return NextResponse.json({ error: '조회할 사원번호가 필요합니다.' }, { status: 400 });
    }
    let empNoFilter = requestedEmpNo;

    if (!session.isAdmin) {
      const supabase = getAdminClient();
      let allowedEmpNos = [];

      if (session.isLeader || isLeaderPosition(session.position)) {
        const sessionDept = normalizeDeptLoose(session.dept || session.team);
        const { data: teamEmployees, error: teamEmployeeError } = await supabase
          .from('sa_employees')
          .select('emp_no, dept')
          .eq('is_active', true);
        if (teamEmployeeError) throw teamEmployeeError;
        allowedEmpNos = (teamEmployees || [])
          .filter((employee) => sessionDept && normalizeDeptLoose(employee.dept) === sessionDept)
          .map((employee) => String(employee.emp_no || '').trim())
          .filter(Boolean);
      } else if (session.empNo) {
        allowedEmpNos = [String(session.empNo).trim()];
      }

      if (allowedEmpNos.length === 0) {
        return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 403 });
      }

      if (requested) {
        const allowedSet = new Set(allowedEmpNos);
        const unauthorized = requested.some((empNo) => !allowedSet.has(empNo));
        if (unauthorized) {
          return NextResponse.json({ error: '조회 권한이 없습니다.' }, { status: 403 });
        }
        empNoFilter = requested.join(',');
      } else {
        empNoFilter = allowedEmpNos.join(',');
      }
    }

    if (!empNoFilter && month) {
      const currentMonth = getKstMonthKey();
      if (month < currentMonth) {
        const cacheKey = `${month}_${dashboardOnly}_${excludeLogs}`;
        const cached = attendanceCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp < 30 * 60 * 1000)) { // 30 min cache
          return NextResponse.json(cached.data);
        }
      }
    }

    const appSettings = getSettings();
    const nightCheckinGraceHours = Number(appSettings?.nightCheckinGraceHours ?? 3) || 3;

    const scope = empNoFilter ? empNoFilter.split(',').map(value => value.trim()).filter(Boolean) : null;
    const [attendance, employeeSchedules, overtimeSettings, overtimeRounds] = await Promise.all([
      fetchAttendanceLogs(month, { dashboardOnly, excludeLogs, empNo: scope }),
      fetchEmployeeSchedules(scope),
      fetchOvertimeSettings(),
      fetchEmployeeOvertimeRounds(scope),
    ]);
    const {
      logs: rawLogs, 
      employees, 
      leaves = [], 
      corrections = [], 
      overrides = [], 
      teamSchedulePatterns = [],
      manualCheckins = [], 
      isDemo, 
      error 
    } = attendance;
    const employeeScheduleMap = buildEmployeeScheduleMap(employeeSchedules);

    // Create override map: empNo_workDate -> schedule_start
    const overrideMap = buildScheduleOverrideMap(overrides);
    const teamPatternMap = buildTeamSchedulePatternMap(teamSchedulePatterns);

    // Create correction map: empNo_workDate -> correctedOutTime
    const correctionMap = new Map();
    corrections.forEach((c) => {
      correctionMap.set(`${c.emp_no}_${c.work_date}`, c.corrected_out_time);
    });

    // 1.5. 각 사원별/일자별 최초 출근 시간 추출 및 지각 판별 (야근 추정 룰 적용)
    // logs는 시간 역순(내림차순)으로 정렬되어 있으므로 그룹화 후 오름차순 정렬하여 처리합니다.
    const getEmployeeLeaveForDate = (empNo, dateStrCompat) => {
      return leaves.find((l) => l.empNo === empNo && dateStrCompat >= l.startDate && dateStrCompat <= l.endDate);
    };

    const formatDateLocal = (date) => getKstDateKey(date);

    const shiftDate = (dateStr, days) => shiftKstDateKey(dateStr, days);

    const getSchedulePairForDate = (empNo, dept, dateStr) => {
      const empKey = normalizeEmpNoKey(empNo);
      const override = overrideMap.get(`${empKey}_${dateStr}`) || null;
      const normalizedDept = String(dept || '').trim().replace(/\s+/g, '');
      const teamPattern = teamPatternMap.get(`${normalizedDept}_${dateStr}`) || null;
      const baseSchedule = employeeScheduleMap.get(empKey) || {};
      return resolveSchedulePairForDate({
        dept,
        dateStr,
        baseScheduleStart: baseSchedule.start || '08:00',
        baseScheduleEnd: baseSchedule.end || '',
        override,
        teamPattern,
      });
    };

    const getWorkWindowForDate = (workDate, schedule) => {
      if (!schedule?.start || !schedule?.end) {
        return null;
      }
      const start = new Date(`${workDate}T${normalizeTime(schedule.start, '08:00')}:00+09:00`);
      const end = new Date(`${workDate}T${normalizeTime(schedule.end, '17:00')}:00+09:00`);
      const overnight = toMinutes(schedule.end) <= toMinutes(schedule.start);
      if (overnight) {
        end.setDate(end.getDate() + 1);
      }
      return {
        start: new Date(start.getTime() - (overnight ? nightCheckinGraceHours : 0) * 60 * 60 * 1000),
        end: new Date(end.getTime() + 5 * 60 * 60 * 1000)
      };
    };

    const isLogWithinWindow = (logTime, workDate, schedule) => {
      const timestamp = new Date(`${String(logTime || '').replace(' ', 'T')}+09:00`).getTime();
      const window = getWorkWindowForDate(workDate, schedule);
      if (!window) return false;
      return timestamp >= window.start.getTime() && timestamp <= window.end.getTime();
    };

    const getWorkOrder = (logTime, schedule) => {
      const timeOnly = String(logTime || '').split(' ')[1] || '00:00:00';
      const minutes = toMinutes(timeOnly);
      if (!schedule || !schedule.end || toMinutes(schedule.end) > toMinutes(schedule.start)) {
        return minutes;
      }
      const hour = Math.floor(minutes / 60);
      if (hour >= 12) {
        return minutes;
      }
      return minutes + 24 * 60;
    };

    const getCheckoutThreshold = (workDate, schedule, dayLeave = null) => {
      if (!workDate || !schedule) return null;
      if (dayLeave && isAfternoonHalfLeave(dayLeave)) {
        const start = new Date(`${workDate}T${normalizeTime(schedule.start, '08:00')}:00+09:00`);
        start.setHours(start.getHours() + 4);
        return start;
      }
      const end = new Date(`${workDate}T${normalizeTime(schedule.end, '17:00')}:00+09:00`);
      if (toMinutes(schedule.end) <= toMinutes(schedule.start)) {
        end.setDate(end.getDate() + 1);
      }
      end.setHours(end.getHours() - 3);
      return end;
    };

    // 모든 로그를 퇴근 후보로 취급 - 하루 중 가장 늦은 기록이 퇴근
    const isCheckoutCandidateForLog = () => true;

    // 새벽 야근 대응: 사업개발팀/사업관리 1~3팀의 06:00 이전 출입은 전날 퇴근으로 처리
    const assignWorkDateForLog = (log) => {
      const actualDate = String(log.logTime || '').split(' ')[0];
      if (!actualDate) return null;
      if (log.workDate && log.workDate !== actualDate) {
        return log.workDate;
      }

      const dept = employeeDeptMap.get(String(log.empNo || '').trim()) || '';
      const cutoffMinutes = getEarlyMorningCarryoverCutoffMinutes(dept);
      if (cutoffMinutes !== null) {
        const timeOnly = String(log.logTime || '').split(' ')[1] || '00:00:00';
        if (toMinutes(timeOnly) < cutoffMinutes) {
          return shiftDate(actualDate, -1);
        }
      }

      const prevDate = shiftDate(actualDate, -1);
      const prevSchedule = getSchedulePairForDate(log.empNo, dept, prevDate);
      if (isOvernightSchedule(prevSchedule) && isLogWithinWindow(log.logTime, prevDate, prevSchedule)) {
        return prevDate;
      }

      const currentSchedule = getSchedulePairForDate(log.empNo, dept, actualDate);
      if (isOvernightSchedule(currentSchedule) && isLogWithinWindow(log.logTime, actualDate, currentSchedule)) {
        return actualDate;
      }

      return actualDate;
    };
    const resolveScheduleTimeForDate = (empNo, dept, dateStr) => {
      return getSchedulePairForDate(empNo, dept, dateStr)?.start || '';
    };

    const employeeDeptMap = new Map(
      (employees || []).map((emp) => [String(emp.empNo || '').trim(), String(emp.dept || '').trim()])
    );

    const normalizeMonthlyReportLogs = (inputLogs) => {
      return [...(inputLogs || [])]
        .map((log) => {
          const actualDate = String(log.logTime || '').split(' ')[0];
          const timeOnly = String(log.logTime || '').split(' ')[1] || '00:00:00';
          const minutes = toMinutes(timeOnly);
          const workDate = log.workDate || actualDate;
          const workOrder = Number.isFinite(Number(log.workOrder))
            ? Number(log.workOrder)
            : minutes;

          return {
            ...log,
            workDate,
            workOrder,
          };
        })
        .sort((a, b) => b.logTime.localeCompare(a.logTime));
    };

    const baseLogs = (rawLogs || []).map((log) => {
      const actualDate = String(log.logTime || '').split(' ')[0];
      const workDate = assignWorkDateForLog(log);
      const dept = employeeDeptMap.get(String(log.empNo || '').trim()) || '';
      const schedulePair = getSchedulePairForDate(log.empNo, dept, workDate || String(log.logTime || '').split(' ')[0]);
      const dayLeave = getEmployeeLeaveForDate(log.empNo, String(workDate || String(log.logTime || '').split(' ')[0]).replace(/-/g, ''));
      const roleText = String(log.adjustedRole || '').trim().toLowerCase();
      const isIgnored = roleText.includes('무시') || roleText.includes('ignore');
      const isAdjustedCheckout = Boolean(log.isAdjustedCheckout) || roleText.includes('퇴') || roleText.includes('checkout');
      const isAdjustedCheckin = Boolean(log.isAdjustedCheckin) || roleText.includes('출') || roleText.includes('checkin');
      const scheduledWorkOrder = getWorkOrder(log.logTime, schedulePair);
      const savedWorkOrder = Number.isFinite(Number(log.workOrder)) ? Number(log.workOrder) : null;
      const carriedOverFromNextDay = Boolean(workDate && actualDate && workDate !== actualDate);
      const needsCarryoverSortOffset = carriedOverFromNextDay && !isOvernightSchedule(schedulePair);
      const workOrder = isAdjustedCheckout || isAdjustedCheckin
        ? savedWorkOrder ?? (isAdjustedCheckout ? scheduledWorkOrder + 24 * 60 : scheduledWorkOrder - 24 * 60)
        : scheduledWorkOrder + (needsCarryoverSortOffset ? 24 * 60 : 0);

      return {
        ...log,
        workDate,
        workOrder,
        isCheckoutCandidate: isCheckoutCandidateForLog(log.logTime, workDate || String(log.logTime || '').split(' ')[0], schedulePair, dayLeave),
        isAdjustedCheckout,
        isAdjustedCheckin,
        isIgnored,
      };
    }).filter((log) => !log.isIgnored);

    const allRawLogs = normalizeMonthlyReportLogs(baseLogs);

    const logsByEmpAndDate = {}; // empNo -> workDate -> [logs]
    allRawLogs.forEach((log) => {
      const dateStr = log.workDate || log.logTime.split(' ')[0];
      if (!logsByEmpAndDate[log.empNo]) logsByEmpAndDate[log.empNo] = {};
      if (!logsByEmpAndDate[log.empNo][dateStr]) logsByEmpAndDate[log.empNo][dateStr] = [];
      logsByEmpAndDate[log.empNo][dateStr].push(log);
    });

    // 각 사원별로 루프를 돌며 일자별 첫 출근(입실) 시각을 판단
    Object.keys(logsByEmpAndDate).forEach((empNo) => {
      const dateMap = logsByEmpAndDate[empNo];
      const dates = Object.keys(dateMap).sort(); // 날짜 오름차순
      dates.forEach((dateStr, idx) => {
        const getLogPriority = (log) => Number.isFinite(Number(log.manualPriority)) ? Number(log.manualPriority) : 1;
        const dayLogs = dateMap[dateStr].sort((a, b) =>
          getLogPriority(a) - getLogPriority(b) ||
          (a.workOrder ?? 0) - (b.workOrder ?? 0) ||
          a.logTime.localeCompare(b.logTime)
        );
        let firstLog = dayLogs[0];
        let timeOnly = firstLog.logTime.split(' ')[1]; // "HH:MM:SS"

        // 지각 비교 기준 시각
        const dept = employeeDeptMap.get(empNo) || '';
        const schedulePair = getSchedulePairForDate(empNo, dept, dateStr);
        const scheduleTime = schedulePair?.start || '';
        const dayLeave = getEmployeeLeaveForDate(empNo, dateStr.replace(/-/g, ''));

        // 첫 출입 시간이 07시 이후일 때만 정식 출근으로 간주하고 지각 판별
        const isOfficialCheckin = timeOnly >= '07:00:00';
        let isLate = false;
        if (scheduleTime) {
          let lateLimit = `${scheduleTime}:59`;
          if (scheduleTime === '12:00') {
            lateLimit = '13:00:59';
          }
          isLate = isOfficialCheckin && timeOnly > lateLimit;
          if (dayLeave) {
            if (dayLeave.leaveCode === '12' || dayLeave.leaveCode === '60' || parseFloat(dayLeave.leaveDays) === 1.0) {
              isLate = false;
            } else {
              isLate = timeOnly > getLateCheckinLimit(dayLeave, scheduleTime);
            }
          }
        }

        // 해당 일자의 모든 로그 중, 첫번째 출근 로그에 isLate 결과 기록
        dayLogs.forEach((l) => {
          if (l.id === firstLog.id && isOfficialCheckin) {
            l.isLate = isLate;
          } else {
            l.isLate = false;
          }
        });
      });
    });

    // 필터링: 당일(todayStr) 이외의 과거 날짜에 대해서는 출입 로그 중 최초(출근) 및 최종(퇴근) 기록만 남겨 전송 데이터 대폭 축소
    const now = new Date();
    const todayStr = getKstDateKey(now);

    const filteredLogs = [];
    Object.keys(logsByEmpAndDate).forEach((empNo) => {
      const dateMap = logsByEmpAndDate[empNo];
      Object.keys(dateMap).forEach((dateStr) => {
        const dayLogs = dateMap[dateStr];
        if (dateStr === todayStr || dayLogs.length <= 1) {
          filteredLogs.push(...dayLogs);
        } else {
          const first = dayLogs[0];
          const last = dayLogs[dayLogs.length - 1];
          filteredLogs.push(first);
          if (last.id !== first.id) {
            filteredLogs.push(last);
          }
        }
      });
    });

    const logs = filteredLogs.sort((a, b) => b.logTime.localeCompare(a.logTime));

    // 1. 전체 직원 목록 기준 설정
    const allEmployeesMap = new Map();
    if (employees && employees.length > 0) {
      employees.forEach((emp) => {
        const empNo = emp.empNo || emp.emp_no;
        if (!empNo) return;
        allEmployeesMap.set(empNo, {
          empNo,
          name: emp.name,
          dept: emp.dept,
          cardNo: emp.cardNo || ''
        });
      });
    } else {
      logs.forEach((log) => {
        const empNo = log.empNo || log.emp_no || log.Sabun;
        if (!empNo) return;
        allEmployeesMap.set(empNo, {
          empNo,
          name: log.name,
          dept: log.dept,
          cardNo: log.cardNo || ''
        });
      });
    }

    const totalEmployeesCount = allEmployeesMap.size || 10;

    // 2. 오늘 날짜 기준 로그 필터
    const todayStrCompat = todayStr.replace(/-/g, '');

    const todayLogs = logs.filter((log) => (log.workDate || log.logTime.split(' ')[0]) === todayStr);

    // 오늘 직원별 로그 그룹화
    const empTodayMap = new Map();
    todayLogs.forEach((log) => {
      if (!empTodayMap.has(log.empNo)) {
        empTodayMap.set(log.empNo, []);
      }
      empTodayMap.get(log.empNo).push(log);
    });

    let presentCount = 0;
    let lateCount = 0;
    let workingNowCount = 0;
    let absentCount = 0;
    let leaveCount = 0;
    const employeeStatuses = [];

    // 3. 전체 직원 목록 기준으로 오늘 상태 계산
    allEmployeesMap.forEach((emp, empNo) => {
      const empLogs = empTodayMap.get(empNo) || [];
      const todayStr = getKstDateKey(now);
      const dept = employeeDeptMap.get(empNo) || '';
      const isManagedDept = isManagedAttendanceDept(dept);
      const schedulePair = getSchedulePairForDate(empNo, dept, todayStr);
      const scheduleTime = schedulePair?.start || '';
      const todayLeave = getEmployeeLeaveForDate(empNo, todayStrCompat);

      if (todayLeave) {
        leaveCount++;
      }

      // 야근 추정 룰 적용하여 오늘 유효 출근 로그 필터링
      let officialLogs = [...empLogs].sort((a, b) =>
        (Number.isFinite(Number(a.manualPriority)) ? Number(a.manualPriority) : 1) -
        (Number.isFinite(Number(b.manualPriority)) ? Number(b.manualPriority) : 1) ||
        (a.workOrder ?? 0) - (b.workOrder ?? 0) ||
        a.logTime.localeCompare(b.logTime)
      );
      let firstLog = officialLogs[0];
      let hasValidTodayLog = officialLogs.length > 0;

      if (hasValidTodayLog && firstLog) {
        presentCount++;

        // 퇴근 표시용: 마지막 로그 = 퇴근 시간 (로그가 2개 이상이고 첫 로그와 다를 때)
        const lastLog = officialLogs[officialLogs.length - 1];
        const hasDistinctCheckout = officialLogs.length >= 2 && lastLog.logTime !== firstLog.logTime;
        const lastCheckoutLog = hasDistinctCheckout ? lastLog : null;

        // 지각 여부 계산
        const checkInTimeOnly = firstLog.logTime.split(' ')[1]; // "HH:MM:SS"
        let checkInLimit = `${scheduleTime}:59`;
        if (scheduleTime === '12:00') {
          checkInLimit = '13:00:59';
        }
        let isLate = false;

        if (scheduleTime) {
          if (todayLeave) {
            if (todayLeave.leaveCode === '12' || todayLeave.leaveCode === '60' || parseFloat(todayLeave.leaveDays) === 1.0) {
              isLate = false; // full day leave is never late
            } else {
              checkInLimit = getLateCheckinLimit(todayLeave, scheduleTime);
              isLate = checkInTimeOnly > checkInLimit;
            }
          } else {
            isLate = checkInTimeOnly > checkInLimit;
          }
        }

        if (isLate) lateCount++;

        // 현재 근무 여부 판단
        // 대시보드 상태는 출입기록이 있으면 모두 근무중으로 본다.
        const correctedOut = correctionMap.get(`${empNo}_${todayStr}`);
        const hasAttendance = officialLogs.length > 0;
        let status = '근무중';

        if (todayLeave) {
          status = getLeaveMeta(todayLeave).label;
        } else if (!hasAttendance) {
          status = '미출근';
          absentCount++;
        } else {
          workingNowCount++;
        }

        let outTimeText = '-';
        if (correctedOut) {
          outTimeText = String(correctedOut).includes('T')
            ? String(correctedOut).split('T')[1].substring(0, 5)
            : String(correctedOut).split(' ')[1]?.substring(0, 5) || '-';
        } else if (lastCheckoutLog) {
          outTimeText = lastCheckoutLog.logTime.split(' ')[1].substring(0, 5);
        }

        employeeStatuses.push({
          ...emp,
          status,
          checkIn: firstLog.logTime.split(' ')[1].substring(0, 5), // "HH:MM"
          checkOut: outTimeText,
          isLate,
          lastGate: lastCheckoutLog?.gateName || officialLogs[officialLogs.length - 1]?.gateName || '-',
          scheduleTime,
          scheduleEndTime: schedulePair?.end || '',
          isManagedAttendanceDept: isManagedDept,
          todayLeave: todayLeave ? {
            leaveCode: todayLeave.leaveCode,
            leaveName: todayLeave.leaveName,
            leaveDays: todayLeave.leaveDays
          } : null
        });
      } else {
        // 로그 없음
        let status = '미출근';
        if (todayLeave) {
          status = getLeaveMeta(todayLeave).label;
        } else {
          status = '미출근';
          absentCount++;
        }

        employeeStatuses.push({
          ...emp,
          status,
          checkIn: '-',
          checkOut: '-',
          isLate: false,
          lastGate: '-',
          scheduleTime,
          scheduleEndTime: getSchedulePairForDate(empNo, dept, todayStr)?.end || '',
          isManagedAttendanceDept: isManagedDept,
          todayLeave: todayLeave ? {
            leaveCode: todayLeave.leaveCode,
            leaveName: todayLeave.leaveName,
            leaveDays: todayLeave.leaveDays
          } : null
        });
      }
    });

    // 4. 주간 트렌드 (최근 7일) - 대시보드에서는 제거하지만 API 하위 호환성 유지
    const weeklyTrend = [];
    for (let i = 6; i >= 0; i--) {
      const dStr = shiftKstDateKey(todayStr, -i);
      const d = new Date(`${dStr}T12:00:00+09:00`);
      const dayName = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(d);

      const dayLogs = logs.filter((log) => (log.workDate || log.logTime.split(' ')[0]) === dStr);
      const dayEmpNos = new Set(dayLogs.map((log) => log.Sabun || log.empNo));

      if ((dayName === '일' || dayName === '토') && dayEmpNos.size === 0) continue;

      weeklyTrend.push({
        date: dStr.substring(5, 10).replace('-', '/'),
        dayName,
        count: dayEmpNos.size,
        rate: totalEmployeesCount > 0 ? Math.round((dayEmpNos.size / totalEmployeesCount) * 100) : 0
      });
    }

    // 5. 부서별 분포
    const deptDistribution = {};
    employeeStatuses.forEach((emp) => {
      if (!deptDistribution[emp.dept]) {
        deptDistribution[emp.dept] = { total: 0, present: 0, late: 0 };
      }
      deptDistribution[emp.dept].total++;
      if (emp.status !== '미출근' && emp.status !== '연차') {
        deptDistribution[emp.dept].present++;
        if (emp.isLate) deptDistribution[emp.dept].late++;
      }
    });

    const formattedDeptData = Object.keys(deptDistribution).map((dept) => ({
      name: dept,
      total: deptDistribution[dept].total,
      present: deptDistribution[dept].present,
      late: deptDistribution[dept].late
    }));

    // 전체 직원 리스트 정렬본
    const allEmployeesList = Array.from(allEmployeesMap.values()).map((emp) => {
      const todayStr = getKstDateKey(now);
      const baseSchedule = employeeScheduleMap.get(normalizeEmpNoKey(emp.empNo)) || {};
      const todaySchedulePair = getSchedulePairForDate(emp.empNo, emp.dept, todayStr) || {};
      const baseScheduleTime = baseSchedule.start || todaySchedulePair?.start || '';
      const baseScheduleEndTime = baseSchedule.end || todaySchedulePair?.end || '';
      const scheduleTime = todaySchedulePair?.start || baseScheduleTime;
      const scheduleEndTime = todaySchedulePair?.end || baseScheduleEndTime;
      return {
        ...emp,
        baseScheduleTime,
        baseScheduleEndTime,
        scheduleTime,
        scheduleEndTime,
        isManagedAttendanceDept: isManagedAttendanceDept(emp.dept),
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    const result = {
      isDemo,
      error: error || null,
      mode: 'supabase',
      stats: {
        totalEmployees: totalEmployeesCount,
        present: presentCount,
        absent: absentCount,
        late: lateCount,
        workingNow: workingNowCount,
        leave: leaveCount,
        attendanceRate: totalEmployeesCount > 0 ? Math.round((presentCount / totalEmployeesCount) * 100) : 0
      },
      weeklyTrend,
      deptData: formattedDeptData,
      employeeStatuses: employeeStatuses.sort((a, b) => {
        const statusPriority = { 
          '근무중': 1, 
          '오전반차': 2, 
          '오후반차': 3, 
          '연차': 4, 
          '퇴근': 5, 
          '미출근': 6 
        };
        return (statusPriority[a.status] || 9) - (statusPriority[b.status] || 9) || a.name.localeCompare(b.name);
      }),
      recentLogs: logs.slice(0, 15).map((log) => ({
        ...log,
        timeOnly: log.logTime.split(' ')[1].substring(0, 5),
        dateOnly: log.logTime.split(' ')[0].substring(5, 10).replace('-', '/')
      })),
      allLogs: logs,
      allEmployees: allEmployeesList,
      leaves: leaves,
      corrections,
      overrides,
      teamSchedulePatterns,
      manualCheckins,
      overtimeSettings,
      overtimeRounds: overtimeRounds || []
    };

    if (!empNoFilter && month) {
      const currentMonth = getKstMonthKey();
      if (month < currentMonth) {
        const cacheKey = `${month}_${dashboardOnly}_${excludeLogs}`;
        attendanceCache.set(cacheKey, { timestamp: Date.now(), data: { success: true, ...result } });
      }
    }

    return NextResponse.json({ success: true, ...result });

  } catch (err) {
    console.error('API attendance error:', err);
    return NextResponse.json({
      success: false,
      error: publicErrorMessage(err, '근태 정보를 불러오는 중 오류가 발생했습니다.')
    }, { status: 500 });
  }
}
