import { getLeaveDisplayLabel } from './leaveRules.js';
import { normalizeEmpNoKey } from './dashboardUtils.js';

const pad2 = (value) => String(value).padStart(2, '0');

const getMonthDays = (month) => {
  const [year, monthNumber] = String(month).split('-').map(Number);
  if (!year || !monthNumber) return [];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => {
    const date = new Date(Date.UTC(year, monthNumber - 1, index + 1));
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()];
    const dateStr = `${year}-${pad2(monthNumber)}-${pad2(index + 1)}`;
    return { dateStr, label: `${pad2(monthNumber)}/${pad2(index + 1)}(${weekday})` };
  });
};

const getTimePart = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:T|\s)(\d{1,2}:\d{2})/);
  return match?.[1] || raw.slice(0, 5);
};

const getEmployeeKey = (value) => normalizeEmpNoKey(value);

const normalizeDateKey = (value) => {
  const raw = String(value ?? '').trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  return raw.slice(0, 10);
};

export const getSelectedMonths = (year, months) => {
  const yearNumber = Number(year);
  return [...new Set((months || [])
    .map(Number)
    .filter((month) => Number.isInteger(month) && month >= 1 && month <= 12)
    .map((month) => `${yearNumber}-${pad2(month)}`))].sort();
};

export const buildAttendanceExportRows = ({ month, employees = [], logs = [], leaves = [] }) => {
  const days = getMonthDays(month);
  const logMap = new Map();
  const lateMap = new Map();

  logs
    .filter((log) => !String(log.adjustedRole || log.eventType || '').includes('무시'))
    .forEach((log) => {
      const empNo = getEmployeeKey(log.empNo || log.emp_no);
      const workDate = String(log.workDate || log.work_date || log.logTime || log.log_time || '').slice(0, 10);
      if (!empNo || !workDate.startsWith(`${month}-`)) return;
      const key = `${empNo}_${workDate}`;
      const time = getTimePart(log.logTime || log.log_time);
      if (!time) return;
      const values = logMap.get(key) || [];
      values.push({ time, order: Number(log.workOrder) || 0, raw: String(log.logTime || log.log_time || '') });
      logMap.set(key, values);
      if (log.isLate) lateMap.set(key, true);
    });

  const leaveMap = new Map();
  leaves.forEach((leave) => {
    const empNo = getEmployeeKey(leave.empNo || leave.emp_no);
    const start = normalizeDateKey(leave.startDate || leave.start_date || '').replace(/-/g, '');
    const end = normalizeDateKey(leave.endDate || leave.end_date || '').replace(/-/g, '');
    if (!empNo || !start || !end) return;
    days.forEach(({ dateStr }) => {
      const compact = dateStr.replace(/-/g, '');
      if (compact >= start && compact <= end) {
        leaveMap.set(`${empNo}_${dateStr}`, getLeaveDisplayLabel(leave) || leave.name || leave.type || leave.label || '휴가');
      }
    });
  });

  return employees.map((employee) => {
    const empNo = getEmployeeKey(employee.empNo || employee.emp_no);
    const row = {
      사번: String(employee.empNo || employee.emp_no || '').trim(),
      이름: employee.name || employee.emp_name || '',
      부서: employee.dept || employee.team || '',
    };
    let presentDays = 0;
    let lateDays = 0;
    let leaveDays = 0;
    days.forEach(({ dateStr, label }) => {
      const key = `${empNo}_${dateStr}`;
      const values = (logMap.get(key) || []).sort((a, b) => a.raw.localeCompare(b.raw));
      const leave = leaveMap.get(key);
      if (values.length > 0) presentDays += 1;
      if (lateMap.has(key)) lateDays += 1;
      if (leave) leaveDays += 1;
      const times = values.length > 1 ? `${values[0].time}\n${values.at(-1).time}` : values[0]?.time || '';
      row[label] = leave ? `${leave}${times ? `\n${times}` : ''}` : times;
    });
    row['출근일수'] = presentDays;
    row['지각일수'] = lateDays;
    row['휴가일수'] = leaveDays;
    return row;
  });
};

export const buildAttendanceTableRows = ({ fromDate, toDate, employees = [], logs = [], leaves = [] }) => {
  const employeeMap = new Map(employees
    .map((employee) => [getEmployeeKey(employee.empNo || employee.emp_no), employee])
    .filter(([empNo]) => Boolean(empNo)));
  const logMap = new Map();
  logs
    .filter((log) => !String(log.adjustedRole || log.eventType || '').includes('무시'))
    .forEach((log) => {
      const empNo = getEmployeeKey(log.empNo || log.emp_no);
      const date = String(log.workDate || log.work_date || log.logTime || log.log_time || '').slice(0, 10);
      const time = getTimePart(log.logTime || log.log_time);
      if (!empNo || !employeeMap.has(empNo) || !date || date < fromDate || date > toDate || !time) return;
      const key = `${empNo}_${date}`;
      const values = logMap.get(key) || [];
      values.push({ time, raw: String(log.logTime || log.log_time || ''), isLate: Boolean(log.isLate) });
      logMap.set(key, values);
    });

  const leaveMap = new Map();
  leaves.forEach((leave) => {
    const empNo = getEmployeeKey(leave.empNo || leave.emp_no);
    const start = normalizeDateKey(leave.startDate || leave.start_date || '');
    const end = normalizeDateKey(leave.endDate || leave.end_date || '');
    if (!empNo || !employeeMap.has(empNo) || !start || !end) return;
    const cursor = new Date(`${start}T00:00:00Z`);
    const last = new Date(`${end}T00:00:00Z`);
    while (cursor <= last) {
      const date = cursor.toISOString().slice(0, 10);
      if (date >= fromDate && date <= toDate) {
        leaveMap.set(`${empNo}_${date}`, getLeaveDisplayLabel(leave) || leave.name || leave.type || leave.label || '휴가');
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  });

  const keys = [...new Set([...logMap.keys(), ...leaveMap.keys()])];
  return keys.map((key) => {
    const [empNo, date] = key.split('_');
    const employee = employeeMap.get(empNo) || {};
    const values = (logMap.get(key) || []).sort((a, b) => a.raw.localeCompare(b.raw));
    const leave = leaveMap.get(key) || '';
    return {
      날짜: date,
      이름: employee.name || employee.emp_name || '',
      부서: employee.dept || employee.team || '',
      출근: values[0]?.time || '',
      퇴근: values.length > 1 ? values.at(-1).time : '',
      상태: leave || (values.some((value) => value.isLate) ? '지각' : '정상'),
      비고: leave ? '휴가' : '',
      연차사용내역: leave,
      _empNo: empNo,
    };
  }).sort((a, b) => a.날짜.localeCompare(b.날짜) || a.이름.localeCompare(b.이름, 'ko') || a._empNo.localeCompare(b._empNo))
    .map(({ _empNo, ...row }) => row);
};
