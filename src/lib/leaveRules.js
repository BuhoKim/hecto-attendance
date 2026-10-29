import { getHolidayNameByDate } from './holidayCalendar.js';

export const CALENDAR_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export const CALENDAR_LEGENDS = [
  { label: '연차', color: '#5B21B6' },
  { label: '공가', color: '#64748B' },
  { label: '공가 [오전]', color: '#0EA5E9' },
  { label: '4시간휴가 [오전]', color: '#F97316' },
  { label: '4시간휴가 [오후]', color: '#10B981' },
  { label: '기타휴가', color: '#EC4899' },
];

export const LEAVE_TYPE_META = {
  연차: {
    label: '연차',
    color: '#5B21B6',
    bg: 'rgba(91, 33, 182, 0.26)',
    border: 'rgba(91, 33, 182, 0.46)',
  },
  공가: {
    label: '공가',
    color: '#64748B',
    bg: 'rgba(100, 116, 139, 0.18)',
    border: 'rgba(100, 116, 139, 0.34)',
  },
  오전반차: {
    label: '오전반차',
    color: '#F97316',
    bg: 'rgba(249, 115, 22, 0.20)',
    border: 'rgba(249, 115, 22, 0.40)',
  },
  오후반차: {
    label: '오후반차',
    color: '#10B981',
    bg: 'rgba(16, 185, 129, 0.20)',
    border: 'rgba(16, 185, 129, 0.40)',
  },
  오전반반차: {
    label: '오전반반차',
    color: '#0EA5E9',
    bg: 'rgba(14, 165, 233, 0.20)',
    border: 'rgba(14, 165, 233, 0.40)',
  },
  오후반반차: {
    label: '오후반반차',
    color: '#EC4899',
    bg: 'rgba(236, 72, 153, 0.20)',
    border: 'rgba(236, 72, 153, 0.40)',
  },
  경조휴가: {
    label: '경조휴가',
    color: '#7C3AED',
    bg: 'rgba(124, 58, 237, 0.20)',
    border: 'rgba(124, 58, 237, 0.38)',
  },
  기타휴가: {
    label: '기타휴가',
    color: '#0F172A',
    bg: 'rgba(15, 23, 42, 0.10)',
    border: 'rgba(100, 116, 139, 0.32)',
  },
};

export const STATUS_BADGE_META = {
  근무중: { className: 'green', label: '근무중' },
  미출근: { className: 'gray', label: '미출근' },
  연차: { className: 'gray', label: '연차' },
};

export const LEAVE_STATUS_TYPES = new Set([
  '연차',
  '공가',
  '오전반차',
  '오후반차',
  '오전반반차',
  '오후반반차',
  '경조휴가',
  '기타휴가',
]);

export const CALENDAR_LEAVE_PRIORITY = {
  연차: 0,
  공가: 1,
  오전반차: 2,
  오후반차: 3,
  오전반반차: 4,
  오후반반차: 5,
  경조휴가: 6,
  기타휴가: 7,
};

export const LEAVE_DASHBOARD_GROUPS = [
  { label: '연차 / 공가', types: ['연차', '공가'] },
  { label: '경조휴가 / 기타휴가', types: ['경조휴가', '기타휴가'] },
  { label: '오전반차', types: ['오전반차'] },
  { label: '오후반차', types: ['오후반차'] },
  { label: '오전반반차', types: ['오전반반차'] },
  { label: '오후반반차', types: ['오후반반차'] },
];

export function getHolidayName(dateStr) {
  return getHolidayNameByDate(dateStr) || null;
}

export function isDateHoliday(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6 || !!getHolidayNameByDate(dateStr);
}

const normalizeDept = (value = '') => String(value || '').trim().replace(/\s+/g, '');

export const formatCalendarMonthLabel = (yearMonthStr) => {
  const [year, month] = String(yearMonthStr || '').split('-').map(Number);
  if (!year || !month) return '';
  return `${year}년 ${month}월`;
};

export function normalizeLeaveName(leave) {
  const code = String(leave?.leaveCode ?? leave?.leave_code ?? '').trim();
  const rawName = String(leave?.leaveName ?? leave?.leave_name ?? '').trim();
  const mappedName = LEAVE_CODE_DISPLAY_LABELS[code] || '';
  if (code === '51') return mappedName;

  if (!rawName) return mappedName;
  if (/^\d+$/.test(rawName)) {
    if (mappedName) return mappedName;
    const leaveDays = Number(leave?.leaveDays ?? leave?.leave_days ?? 0);
    if (leaveDays >= 0.99) return '연차';
    if (leaveDays >= 0.49) return '기타휴가';
    return '';
  }
  if (rawName === code && mappedName) return mappedName;
  return rawName;
}

const LEAVE_CODE_DISPLAY_LABELS = {
  '12': '연차',
  '13': '공가',
  '16': '4시간휴가 [오전]',
  '17': '4시간휴가 [오후]',
  '18': '경조휴가',
  '19': '2시간휴가A [07-09]',
  '20': '2시간휴가B [08-10]',
  '21': '2시간휴가C [09-11]',
  '22': '2시간휴가D [10-12]',
  '23': '2시간휴가E [11-13]',
  '24': '2시간휴가F [13-15]',
  '25': '2시간휴가G [14-16]',
  '26': '2시간휴가H [15-17]',
  '27': '2시간휴가I [16-18]',
  '28': '2시간휴가J [17-19]',
  '51': '공가 [오전]',
  '60': '1년미만연차',
  '61': '1년미만 4시간휴가 [오전]',
  '62': '1년미만 4시간휴가 [오후]',
};

const TWO_HOUR_LEAVE_CODES = new Set(['19', '20', '21', '22', '23', '24', '25', '26', '27', '28']);

export function getLeaveDisplayLabel(leave) {
  return normalizeLeaveName(leave);
}

export function getLeaveVisualVariant(leave) {
  const raw = getLeaveDisplayLabel(leave).replace(/\s+/g, '');
  if (!raw) return '';
  if (/연차/.test(raw)) return 'is-annual';
  if (/경조/.test(raw)) return 'is-special';
  if (/공가\[?오전\]?/.test(raw)) return 'is-compoff-am';
  if (/^공가/.test(raw)) return 'is-compoff';
  if (/4시간휴가\[?오전\]?/.test(raw)) return 'is-halfday-am';
  if (/4시간휴가\[?오후\]?/.test(raw)) return 'is-halfday-pm';
  if (/2시간휴가.*\[(08-10|10-12)\]/.test(raw)) return 'is-short-am';
  if (/2시간휴가.*\[(14~16|15~17|17~19)\]/.test(raw)) return 'is-short-pm';
  if (/2시간휴가/.test(raw)) return 'is-short';
  return '';
}

export function looksLikeLeaveStatus(statusText = '') {
  const text = String(statusText || '').trim();
  if (!text) return false;
  if (LEAVE_STATUS_TYPES.has(text)) return true;
  return /연차|공가|휴가|경조|반차|반휴|차/.test(text);
}

export const getLeaveDisplayType = (leave, stat) => {
  const code = String(leave?.leaveCode ?? leave?.leave_code ?? '').trim();
  const name = normalizeLeaveName(leave);
  const normalized = normalizeLeaveType(leave);
  if (normalized !== '기타휴가') return normalized;

  const compact = name.replace(/\s+/g, '');
  const isTwoHourLeave = TWO_HOUR_LEAVE_CODES.has(code) || /2시간휴가/.test(compact);
  if (!isTwoHourLeave) return normalized;

  const rangeMatch = name.match(/\[(\d{2})(?::?(\d{2}))?[~-](\d{2})(?::?(\d{2}))?\]/);
  if (rangeMatch) {
    const startHour = parseInt(rangeMatch[1], 10);
    return startHour < 12 ? '오전반반차' : '오후반반차';
  }

  if (/오전/.test(name) || /07-09|08-10|09-11/.test(name)) return '오전반반차';
  if (/오후/.test(name) || /13-15|14-16|15-17|16-18|17-19/.test(name)) return '오후반반차';

  const inTime = stat?.in || '';
  if (inTime) return inTime < '12:00' ? '오전반반차' : '오후반반차';

  return '기타휴가';
};

export function normalizeLeaveType(leave) {
  const code = String(leave?.leaveCode ?? leave?.leave_code ?? '').trim();
  const name = normalizeLeaveName(leave);
  const compact = name.replace(/\s+/g, '');

  if (/경조/.test(name) || code === '18') return '경조휴가';
  if (/공가/.test(name) || code === '13' || code === '51') return '공가';
  if (/연차/.test(name) || code === '12') return '연차';
  if (/2시간휴가/.test(compact)) {
    const rangeMatch = name.match(/\[(\d{2})(?::?(\d{2}))?[~-](\d{2})(?::?(\d{2}))?\]/);
    if (rangeMatch) {
      const startHour = parseInt(rangeMatch[1], 10);
      if (Number.isFinite(startHour)) {
        return startHour < 12 ? '오전반반차' : '오후반반차';
      }
    }
    if (/오전/.test(name) || /07-09|08-10|09-11|10-12/.test(name)) return '오전반반차';
    if (/오후/.test(name) || /13-15|14-16|15-17|16-18|17-19/.test(name)) return '오후반반차';
  }
  if (/오전반반차|2시간휴가.*(07|08|09)[~-]?(09|10|11)/.test(compact)) return '오전반반차';
  if (/오후반반차|2시간휴가.*(13|14|15|16|17|18)[~-]?(15|16|17|18|19|20)/.test(compact)) return '오후반반차';
  if (/오전반차|4시간휴가.*오전|오전휴가/.test(compact)) return '오전반차';
  if (/오후반차|4시간휴가.*오후|오후휴가/.test(compact)) return '오후반차';
  if (code === '16' || /오전/.test(name)) return '오전반차';
  if (code === '17' || /오후/.test(name)) return '오후반차';
  if (/휴가/.test(name)) return '기타휴가';
  return '기타휴가';
}

export const getLeaveMeta = (leave, stat) => {
  const leaveType = getLeaveDisplayType(leave, stat);
  const baseMeta = LEAVE_TYPE_META[leaveType] || LEAVE_TYPE_META.기타휴가;
  const rawLabel = getLeaveDisplayLabel(leave);

  return {
    ...baseMeta,
    label: rawLabel || baseMeta.label,
    rawLabel: rawLabel || baseMeta.label,
    leaveType,
    variantClassName: getLeaveVisualVariant(leave),
  };
};

export function getStatusBadgeMeta(status, stat = null) {
  const statusText = String(status || '').trim();
  if (!statusText) return { className: 'badge gray', label: '-' };

  if (stat && (stat.leaveName || stat.leave_name || stat.leaveCode || stat.leave_code)) {
    const leaveMeta = getLeaveMeta(
      {
        ...stat,
        leaveName: stat.leaveName || stat.leave_name || statusText,
      },
      stat
    );
    return {
      className: `badge ${leaveMeta.variantClassName || ''}`.trim(),
      label: leaveMeta.label,
      bg: leaveMeta.bg,
      color: leaveMeta.color,
      border: leaveMeta.border,
      style: { background: leaveMeta.bg, color: leaveMeta.color, borderColor: leaveMeta.border },
    };
  }

  if (looksLikeLeaveStatus(statusText)) {
    const leaveMeta = getLeaveMeta({ leaveName: statusText }, stat);
    return {
      className: `badge ${leaveMeta.variantClassName || ''}`.trim(),
      label: leaveMeta.label,
      bg: leaveMeta.bg,
      color: leaveMeta.color,
      border: leaveMeta.border,
      style: { background: leaveMeta.bg, color: leaveMeta.color, borderColor: leaveMeta.border },
    };
  }

  const direct = STATUS_BADGE_META[statusText];
  if (direct) {
    return {
      className: `badge ${direct.className}`,
      label: direct.label,
    };
  }

  if (statusText.includes('근무')) {
    return { className: 'badge green', label: statusText };
  }

  return { className: 'badge gray', label: statusText };
}

export const getLeaveDisplayName = (leave, employeeNameLookup) => {
  const empNoKey = String(leave?.empNo ?? '').replace(/\D/g, '').replace(/^0+/, '') || String(leave?.empNo ?? '');
  return (
    leave?.empName ||
    leave?.name ||
    employeeNameLookup?.get(empNoKey) ||
    employeeNameLookup?.get(String(leave?.empNo)) ||
    leave?.empNo ||
    ''
  );
};

export const getLeaveDetailText = (leave) => {
  const meta = getLeaveMeta(leave);
  return meta.label;
};

export const getLeaveTimeText = () => '';

export const getLeaveDisplaySummary = (leave, stat) => {
  const meta = getLeaveMeta(leave, stat);
  return meta.label;
};

export const sortCalendarLeaves = (leaves = [], employeeNameLookup) => {
  return [...leaves].sort((a, b) => {
    const aPriority = CALENDAR_LEAVE_PRIORITY[normalizeLeaveType(a)] ?? 99;
    const bPriority = CALENDAR_LEAVE_PRIORITY[normalizeLeaveType(b)] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    const aName = getLeaveDisplayName(a, employeeNameLookup);
    const bName = getLeaveDisplayName(b, employeeNameLookup);
    return aName.localeCompare(bName, 'ko');
  });
};
