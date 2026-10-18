const DEFAULT_LINE_LENGTH = 75;

export const MANAGEMENT_DEPTS = ['경영지원실', '경영지원팀'];

export const normalizeDeptName = (value = '') => String(value || '').trim().replace(/\s+/g, '');

export const escapeICSText = (value = '') => String(value || '')
  .replace(/\\/g, '\\\\')
  .replace(/\r?\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

export const formatICSDate = (dateStr) => {
  const value = String(dateStr || '').trim();
  if (!value) return '';
  const normalized = value.replace(/-/g, '');
  if (/^\d{8}$/.test(normalized)) return normalized;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

export const addDaysToDateStr = (dateStr, days) => {
  if (!dateStr) return '';
  const value = String(dateStr || '').trim();
  const normalized = value.replace(/-/g, '');
  let date;
  if (/^\d{8}$/.test(normalized)) {
    const year = Number(normalized.slice(0, 4));
    const month = Number(normalized.slice(4, 6)) - 1;
    const day = Number(normalized.slice(6, 8));
    date = new Date(Date.UTC(year, month, day));
  } else {
    date = new Date(value);
  }
  if (Number.isNaN(date.getTime())) return '';
  date.setDate(date.getDate() + Number(days || 0));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const foldICSLine = (line = '', maxLength = DEFAULT_LINE_LENGTH) => {
  const text = String(line || '');
  // RFC 5545 counts UTF-8 octets, including the continuation space.
  // Iterate code points so a fold never splits a Korean character or emoji.
  const encoder = new TextEncoder();
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxLength && chunk) {
      chunks.push(chunk);
      chunk = ' ';
      bytes = 1;
    }
    chunk += character;
    bytes += size;
  }
  chunks.push(chunk);
  return chunks.join('\r\n');
};

export const buildICS = ({ calendarName, calendarDescription, events = [] }) => {
  const nowStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//HECTO QNM//Attendance Calendar//KO',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeICSText(calendarName || '연차 현황'),
    'X-WR-CALDESC:' + escapeICSText(calendarDescription || ''),
    'X-WR-TIMEZONE:Asia/Seoul',
    'X-PUBLISHED-TTL:PT5M',
    'REFRESH-INTERVAL;VALUE=DURATION:PT5M',
  ];

  events.forEach((event) => {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeICSText(event.uid || `leave-${nowStamp}`)}`);
    lines.push(`DTSTAMP:${nowStamp}`);
    lines.push(`DTSTART;VALUE=DATE:${formatICSDate(event.startDate)}`);
    lines.push(`DTEND;VALUE=DATE:${formatICSDate(event.endDate)}`);
    lines.push(`SUMMARY:${escapeICSText(event.summary || '')}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
    }
    if (event.location) {
      lines.push(`LOCATION:${escapeICSText(event.location)}`);
    }
    if (event.categories) {
      lines.push(`CATEGORIES:${escapeICSText(event.categories)}`);
    }
    lines.push('TRANSP:TRANSPARENT');
    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.map((line) => foldICSLine(line)).join('\r\n') + '\r\n';
};
