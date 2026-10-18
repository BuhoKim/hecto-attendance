export const EXTERNAL_DEPARTMENTS = ['사업개발팀', '사업관리 1팀', '사업관리 2팀', '사업관리 3팀', '사업관리 4팀'];

export function normalizeTime(value, fallback = '00:00') {
  const text = String(value || '').trim();
  return /^\d{2}:\d{2}$/.test(text) ? text : fallback;
}

export function buildATimeBounds({ from, to, fromTime = '00:00', toTime = '23:59' }) {
  return {
    from: `${from.replaceAll('-', '')}${normalizeTime(fromTime).replace(':', '')}00`,
    to: `${to.replaceAll('-', '')}${normalizeTime(toTime, '23:59').replace(':', '')}59`,
  };
}

export function filterTerminalRows(rows, { terminalCodes = [], fromTime = '00:00', toTime = '23:59' } = {}) {
  const codes = new Set((terminalCodes || []).map((code) => String(code).trim()).filter(Boolean));
  const min = normalizeTime(fromTime);
  const max = normalizeTime(toTime, '23:59');
  return (rows || []).filter((row) => {
    const aTime = String(row.a_time || '');
    const time = aTime.length >= 12 ? `${aTime.slice(8, 10)}:${aTime.slice(10, 12)}` : '';
    return (!codes.size || codes.has(String(row.eq_code || '').trim())) && time >= min && time <= max;
  });
}

export function formatTerminalRow(row, employeeMap = new Map()) {
  const employee = employeeMap.get(String(row.emp_no || row.sabun || '')) || {};
  const aTime = String(row.a_time || '');
  return {
    id: row.id,
    date: aTime.length >= 8 ? `${aTime.slice(0, 4)}-${aTime.slice(4, 6)}-${aTime.slice(6, 8)}` : '-',
    time: aTime.length >= 12 ? `${aTime.slice(8, 10)}:${aTime.slice(10, 12)}:${aTime.slice(12, 14) || '00'}` : '-',
    name: employee.name || row.name || '-',
    dept: employee.dept || row.dept || '-',
    terminal: row.eq_code || '-',
    gate: row.gate_name || '-',
    eventType: row.event_type || (String(row.flag1) === '1' ? '출근' : String(row.flag1) === '4' ? '퇴근' : '출입'),
  };
}

export function findMissingOvernightRows(rows, { candidateTerminal = '5005', candidateTerminals = null, candidateStart = '17:00', candidateEnd = '18:00', absenceStart = '20:00', absenceEnd = '04:00' } = {}) {
  const allowedTerminals = new Set(candidateTerminals || [candidateTerminal]);
  const candidates = new Map();
  const overnight = new Set();
  for (const row of rows || []) {
    const aTime = String(row.a_time || '');
    if (aTime.length < 12) continue;
    const empNo = String(row.emp_no || row.sabun || '');
    const date = `${aTime.slice(0, 4)}-${aTime.slice(4, 6)}-${aTime.slice(6, 8)}`;
    const time = `${aTime.slice(8, 10)}:${aTime.slice(10, 12)}`;
    if (allowedTerminals.has(String(row.eq_code || '').trim()) && time >= candidateStart && time < candidateEnd) candidates.set(`${empNo}|${date}`, row);
    if (time >= absenceStart || time <= absenceEnd) {
      const overnightDate = time <= absenceEnd ? shiftDateKey(date, -1) : date;
      overnight.add(`${empNo}|${overnightDate}`);
    }
  }
  return [...candidates.entries()].filter(([key]) => !overnight.has(key)).map(([, row]) => row);
}

export function summarizeMissingOvernightRows(rows, employeeMap = new Map(), options = {}) {
  const candidates = findMissingOvernightRows(rows, options);
  const candidateKeys = new Set(candidates.map((row) => {
    const aTime = String(row.a_time || '');
    return `${String(row.emp_no || row.sabun || '')}|${aTime.slice(0, 8)}`;
  }));
  const grouped = new Map();
  for (const row of rows || []) {
    const aTime = String(row.a_time || '');
    const empNo = String(row.emp_no || row.sabun || '');
    const date = `${aTime.slice(0, 4)}-${aTime.slice(4, 6)}-${aTime.slice(6, 8)}`;
    const key = `${empNo}|${date}`;
    if (!candidateKeys.has(`${empNo}|${aTime.slice(0, 8)}`)) continue;
    const entry = grouped.get(key) || { date, empNo, name: employeeMap.get(empNo)?.name || '-', dept: employeeMap.get(empNo)?.dept || '-', candidateTimes: [], lastTime: '-' };
    const time = aTime.length >= 12 ? `${aTime.slice(8, 10)}:${aTime.slice(10, 12)}` : '-';
    const terminal = String(row.eq_code || '').trim();
    const inCandidateWindow = time >= (options.candidateStart || '17:00') && time < (options.candidateEnd || '18:00');
    if (inCandidateWindow && ['5005', '5006'].includes(terminal) && !entry.candidateTimes.includes(time)) entry.candidateTimes.push(time);
    if (time > entry.lastTime) entry.lastTime = time;
    grouped.set(key, entry);
  }
  return [...grouped.values()].map((entry) => ({ ...entry, candidateTimes: entry.candidateTimes.sort().join(', ') })).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function shiftDateKey(value, days) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
