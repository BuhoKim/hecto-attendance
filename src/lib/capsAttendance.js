import { Buffer } from 'node:buffer';
import * as XLSX from 'xlsx';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_ROWS = 50_000;

export const COMPANY_CODE = '1600';

function normalizeText(value) {
  return String(value ?? '').replace(/\uFEFF/g, '').trim();
}

function normalizeHeaderKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s\-_./()[\]{}]+/g, '');
}

export function normalizeName(value) {
  return normalizeText(value).replace(/^Q[_\s-]*/i, '').trim();
}

export function normalizeEmpNo(value) {
  const digits = normalizeText(value).replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith(COMPANY_CODE) && digits.length >= COMPANY_CODE.length + 8) {
    const local = digits.slice(COMPANY_CODE.length).replace(/^0+/, '') || digits.slice(COMPANY_CODE.length);
    return local.slice(-8).padStart(8, '0');
  }

  if (digits.length <= 8) {
    return digits.padStart(8, '0');
  }

  return digits.slice(-8);
}

export function normalizeSabun(value, empNo) {
  const digits = normalizeText(value).replace(/\D/g, '');
  if (digits.startsWith(COMPANY_CODE) && digits.length >= COMPANY_CODE.length + 8) {
    return `${COMPANY_CODE}${digits.slice(COMPANY_CODE.length).slice(-8).padStart(8, '0')}`;
  }

  if (empNo) {
    return `${COMPANY_CODE}${empNo.padStart(8, '0')}`;
  }

  return '';
}

function normalizeResult(value) {
  const text = normalizeText(value).toUpperCase();
  if (!text) return '';
  if (['O', 'OK', 'Y', 'YES', 'TRUE', 'SUCCESS', '정상', '성공', '합격'].includes(text)) return 'O';
  if (['X', 'NG', 'FAIL', 'FALSE', 'FAILED', '실패', '거절'].includes(text)) return 'X';
  return text;
}

function normalizeDate(value) {
  const text = normalizeText(value);
  if (/^\d{8}$/.test(text)) return text;

  const match = text.match(/^(\d{4})[./-]?(\d{2})[./-]?(\d{2})$/);
  if (match) {
    return `${match[1]}${match[2]}${match[3]}`;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const wholeDays = Math.floor(value);
    const fraction = value - wholeDays;
    const date = new Date(epoch.getTime() + (wholeDays * 24 * 60 * 60 * 1000) + Math.round(fraction * 24 * 60 * 60 * 1000));
    if (!Number.isNaN(date.getTime())) {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    }
  }

  return '';
}

function normalizeTime(value) {
  const text = normalizeText(value);
  const compact = text.replace(/\D/g, '');

  if (compact.length >= 6) {
    return `${compact.slice(0, 2)}${compact.slice(2, 4)}${compact.slice(4, 6)}`;
  }

  if (compact.length === 4) {
    return `${compact.slice(0, 2)}${compact.slice(2, 4)}00`;
  }

  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    return [
      String(match[1]).padStart(2, '0'),
      match[2],
      String(match[3] || '00').padStart(2, '0'),
    ].join('');
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const hour = String(value.getHours()).padStart(2, '0');
    const minute = String(value.getMinutes()).padStart(2, '0');
    const second = String(value.getSeconds()).padStart(2, '0');
    return `${hour}${minute}${second}`;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const fraction = value - Math.floor(value);
    const totalSeconds = Math.round(fraction * 24 * 60 * 60);
    const hour = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minute = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const second = String(totalSeconds % 60).padStart(2, '0');
    return `${hour}${minute}${second}`;
  }

  return '';
}

function toIsoLike(aTime) {
  if (!/^\d{14}$/.test(aTime)) return null;
  return `${aTime.slice(0, 4)}-${aTime.slice(4, 6)}-${aTime.slice(6, 8)}T${aTime.slice(8, 10)}:${aTime.slice(10, 12)}:${aTime.slice(12, 14)}+09:00`;
}

function splitDelimitedLine(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += ch;
  }

  cells.push(current.trim());
  return cells;
}

function detectDelimiter(line) {
  const candidates = ['\t', ',', ';', '|'];
  const scored = candidates.map((delimiter) => ({
    delimiter,
    count: line.split(delimiter).length - 1,
  }));
  const best = scored.sort((a, b) => b.count - a.count)[0];
  return best && best.count > 0 ? best.delimiter : ',';
}

function findHeaderRowIndex(rows) {
  const aliases = new Set([
    '발생일자',
    '발생시각',
    '단말기id',
    '사용자id',
    '이름',
    '사원번호',
    '구분',
    '모드',
    '인증',
    '결과',
    'date',
    'time',
    'name',
    'empno',
    'emp_no',
    'result',
  ].map(normalizeHeaderKey));

  let bestIndex = 0;
  let bestScore = -1;

  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const row = rows[i] || [];
    const score = row.reduce((count, cell) => count + (aliases.has(normalizeHeaderKey(cell)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildHeaderMap(headerRow) {
  const normalized = headerRow.map(normalizeHeaderKey);
  const findIndex = (aliases) => {
    for (const alias of aliases) {
      const idx = normalized.indexOf(normalizeHeaderKey(alias));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const map = {
    date: findIndex(['발생일자', 'date', 'workdate']),
    time: findIndex(['발생시각', 'time', 'worktime', 'logtime']),
    terminalId: findIndex(['단말기id', 'terminalid', 'terminal_id']),
    userId: findIndex(['사용자id', 'userid', 'user_id']),
    name: findIndex(['이름', 'name']),
    empNo: findIndex(['사원번호', '사번', 'empno', 'emp_no', 'employee_no']),
    group: findIndex(['구분', 'group', 'category', 'type']),
    mode: findIndex(['모드', 'mode', 'event', 'eventtype', 'event_type']),
    auth: findIndex(['인증', 'auth', 'authentication']),
    result: findIndex(['결과', 'result', 'status']),
  };

  const fallbackPositions = {
    date: 0,
    time: 1,
    terminalId: 2,
    userId: 3,
    name: 4,
    empNo: 5,
    group: 6,
    mode: 7,
    auth: 8,
    result: 9,
  };

  for (const [field, pos] of Object.entries(fallbackPositions)) {
    if (map[field] < 0 && headerRow.length > pos) {
      map[field] = pos;
    }
  }

  return map;
}

function buildEmployeeIndex(employees = []) {
  const byEmpNo = new Map();
  const names = [];

  for (const emp of employees) {
    const empNo = normalizeEmpNo(emp.emp_no ?? emp.empNo ?? '');
    const name = normalizeName(emp.name ?? emp.empName ?? '');
    const normalized = { ...emp, empNo, normalizedName: name };

    if (empNo) byEmpNo.set(empNo, normalized);
    if (name) names.push(normalized);
  }

  return { byEmpNo, names };
}

function resolveEmployee(row, employeeIndex) {
  const rowEmpNo = normalizeEmpNo(row.empNoRaw);
  if (rowEmpNo && employeeIndex.byEmpNo.has(rowEmpNo)) {
    return employeeIndex.byEmpNo.get(rowEmpNo);
  }

  const rowName = normalizeName(row.nameRaw);
  if (!rowName) return null;

  const exact = employeeIndex.names.find((emp) => emp.normalizedName === rowName);
  if (exact) return exact;

  const contains = employeeIndex.names.find((emp) => {
    return rowName.includes(emp.normalizedName) || emp.normalizedName.includes(rowName);
  });

  return contains || null;
}

function makeAttendanceRow(row, headerMap, employeeIndex) {
  const result = normalizeResult(headerMap.result >= 0 ? row[headerMap.result] : '');
  if (result && result !== 'O') {
    return { record: null, skipReason: null };
  }

  const dateValue = headerMap.date >= 0 ? row[headerMap.date] : '';
  const timeValue = headerMap.time >= 0 ? row[headerMap.time] : '';
  const aDate = normalizeDate(dateValue);
  const aTimePart = normalizeTime(timeValue);
  if (!aDate || !aTimePart) {
    return { record: null, skipReason: '발생일자 또는 발생시각을 해석하지 못함' };
  }

  const rowEmpNoRaw = headerMap.empNo >= 0 ? row[headerMap.empNo] : '';
  const rowNameRaw = headerMap.name >= 0 ? row[headerMap.name] : '';
  if (!normalizeEmpNo(rowEmpNoRaw)) {
    return { record: null, skipReason: null };
  }

  const resolvedEmployee = resolveEmployee({ empNoRaw: rowEmpNoRaw, nameRaw: rowNameRaw }, employeeIndex);
  if (!resolvedEmployee) {
    return { record: null, skipReason: null };
  }

  const empNo = normalizeEmpNo(rowEmpNoRaw || resolvedEmployee.empNo);
  const sabun = normalizeSabun(rowEmpNoRaw || resolvedEmployee.empNo || empNo, empNo);
  if (!empNo || !sabun) {
    return { record: null, skipReason: null };
  }

  const terminalId = headerMap.terminalId >= 0 ? normalizeText(row[headerMap.terminalId]) : '';
  const userId = headerMap.userId >= 0 ? normalizeText(row[headerMap.userId]) : '';
  const group = headerMap.group >= 0 ? normalizeText(row[headerMap.group]) : '';
  const mode = headerMap.mode >= 0 ? normalizeText(row[headerMap.mode]) : '';
  const auth = headerMap.auth >= 0 ? normalizeText(row[headerMap.auth]) : '';
  const aTime = `${aDate}${aTimePart}`;

  return {
    record: {
      sabun,
      emp_no: empNo,
      card_no: userId || null,
      a_time: aTime,
      log_time: toIsoLike(aTime),
      eq_code: terminalId || null,
      gate_name: [group, mode, auth].filter(Boolean).join(' / ') || '출입',
      flag1: null,
      event_type: '출입',
      source: 'caps',
      synced_at: new Date().toISOString(),
    },
    skipReason: null,
  };
}

function parseRows(rows, employeeIndex, meta = {}) {
  if (!rows || rows.length === 0) {
    return {
      rows: [],
      skippedRows: 0,
      totalRows: 0,
      sampleErrors: ['파일이 비어 있습니다.'],
      ...meta,
    };
  }

  const headerIndex = findHeaderRowIndex(rows);
  const headerRow = rows[headerIndex] || rows[0];
  const headerMap = buildHeaderMap(headerRow);
  const dataStartIndex = Math.min(headerIndex + 1, rows.length);
  const parsedRows = [];
  const sampleErrors = [];
  let skippedRows = 0;

  for (let i = dataStartIndex; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (row.every((cell) => normalizeText(cell) === '')) {
      continue;
    }

    const { record, skipReason } = makeAttendanceRow(row, headerMap, employeeIndex);
    if (!record) {
      skippedRows += 1;
      if (skipReason && sampleErrors.length < 5) {
        sampleErrors.push(`${i + 1}행: ${skipReason}`);
      }
      continue;
    }

    parsedRows.push(record);
  }

  return {
    rows: parsedRows,
    skippedRows,
    totalRows: Math.max(rows.length - dataStartIndex, 0),
    sampleErrors,
    headerMap,
    ...meta,
  };
}

function parseDelimitedText(text, employeeIndex) {
  const cleaned = normalizeText(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);

  if (lines.length === 0) {
    return { rows: [], skippedRows: 0, totalRows: 0, sampleErrors: ['파일이 비어 있습니다.'] };
  }

  const delimiter = detectDelimiter(lines[0]);
  const rows = lines.map((line) => splitDelimitedLine(line, delimiter));
  return parseRows(rows, employeeIndex, { delimiter, source: 'text' });
}

function parseWorkbook(buffer, employeeIndex) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    raw: false,
    sheetRows: MAX_SHEET_ROWS,
  });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    return { rows: [], skippedRows: 0, totalRows: 0, sampleErrors: ['워크북에서 시트를 찾을 수 없습니다.'] };
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
  return parseRows(rows, employeeIndex, { source: 'xlsx', sheetName: firstSheetName });
}

export async function parseCapsAttendanceFile(file, employees = []) {
  const employeeIndex = buildEmployeeIndex(employees);
  const fileName = normalizeText(file?.name || '');
  const isWorkbook = /\.(xls|xlsx)$/i.test(fileName);

  if (isWorkbook) {
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new Error('파일 크기는 10MB 이하만 업로드할 수 있습니다.');
    }
    return parseWorkbook(buffer, employeeIndex);
  }

  const text = await file.text();
  return parseDelimitedText(text, employeeIndex);
}
