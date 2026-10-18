import { NextResponse } from 'next/server';
import { publicErrorMessage } from '@/lib/apiError.mjs';
import * as XLSX from 'xlsx';
import { verifySession } from '@/lib/auth';
import { fetchAttendanceLogs } from '@/lib/supabaseDb';
import { shiftKstDateKey } from '@/lib/kstDate';

export const dynamic = 'force-dynamic';

const NIGHT_CUTOFF_MINUTES = 6 * 60;
const LATE_NIGHT_RIDE_MINUTES = 22 * 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SHEET_ROWS = 50_000;

const HEADER_ALIASES = {
  ticketNo: ['이용번호', '번호', 'ticket', 'ticketno'],
  rideTime: ['탑승일시', '이용일시', '탑승시간', 'ride', 'ride time'],
  employeeName: ['직원명', '성명', '이름', '사원명', 'employee', 'employee name'],
  dept: ['부서', '부서명', 'team', 'dept', 'department'],
  reason: ['이용사유', '사유', 'reason'],
  amount: ['결제금액', '금액', 'amount'],
  settleAmount: ['정산완료금액', '정산금액', 'settle amount'],
  status: ['결제상태', '상태', 'status'],
  pickup: ['탑승장소', '탑승지', '출발지', 'pickup'],
  dropoff: ['하차장소', '도착지', 'dropoff'],
};

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function formatRideLabel(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/);
  if (!match) return text || '-';
  return `${match[1]} ${match[2]}`;
}

function parseRideDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  let isoText = text;
  if (/^\d{4}[-/.]\d{2}[-/.]\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    isoText = text.replace(' ', 'T').replace(/\./g, '-').replace(/\//g, '-') + '+09:00';
  }

  const d = new Date(isoText);
  if (Number.isNaN(d.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(d).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hours: Number(parts.hour),
    minutes: Number(parts.minute),
    seconds: Number(parts.second || '0'),
  };
}

function shiftDate(dateStr, days) {
  return shiftKstDateKey(dateStr, days);
}

function getEffectiveWorkDate(rideValue) {
  const parsed = parseRideDate(rideValue);
  if (!parsed) return '';
  if (parsed.hours < NIGHT_CUTOFF_MINUTES / 60) {
    return shiftDate(parsed.date, -1);
  }
  return parsed.date;
}

function getMonthFromDate(dateStr) {
  const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function compareByDateThenTime(a, b) {
  return String(a.auditWorkDate || '').localeCompare(String(b.auditWorkDate || ''))
    || String(a.rideTimeRaw || '').localeCompare(String(b.rideTimeRaw || ''))
    || String(a.employeeName || '').localeCompare(String(b.employeeName || ''));
}

function isLateNightRide(rideDate) {
  if (!rideDate) return false;
  return rideDate.hours >= 22 || rideDate.hours < 6;
}

function getHeaderIndex(headers, aliases) {
  const normalizedHeaders = headers.map(normalizeText);
  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias);
    const index = normalizedHeaders.findIndex((header) => header === normalizedAlias || header.includes(normalizedAlias));
    if (index >= 0) return index;
  }
  return -1;
}

function parseWorkbookRows(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true, sheetRows: MAX_SHEET_ROWS });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });

  if (!rows.length) {
    return { sheetName, headers: [], rows: [] };
  }

  const headers = rows[0].map((value) => String(value ?? '').trim());
  const columnMap = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([key, aliases]) => [key, getHeaderIndex(headers, aliases)]),
  );

  const parsedRows = [];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const pick = (key) => {
      const index = columnMap[key];
      return index >= 0 ? String(row[index] ?? '').trim() : '';
    };

    const parsedRow = {
      rowIndex: i + 1,
      ticketNo: pick('ticketNo'),
      rideTime: pick('rideTime'),
      employeeName: pick('employeeName'),
      dept: pick('dept'),
      reason: pick('reason'),
      amount: pick('amount'),
      settleAmount: pick('settleAmount'),
      status: pick('status'),
      pickup: pick('pickup'),
      dropoff: pick('dropoff'),
    };

    if (Object.values(parsedRow).some((value) => value && value !== String(parsedRow.rowIndex))) {
      parsedRows.push(parsedRow);
    }
  }

  return { sheetName, headers, rows: parsedRows };
}

function normalizeName(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

function normalizeNamePrefix(value) {
  return normalizeName(value).slice(0, 3);
}

function toDateParts(text) {
  const match = String(text || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: match[1], month: match[2], day: match[3] };
}

function getCheckoutMinutesRelative(checkoutValue = '', workDate = '') {
  const text = String(checkoutValue || '').trim();
  if (!text) return null;

  const matchFull = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (matchFull && workDate) {
    const logDate = matchFull[1];
    const hours = Number(matchFull[2]);
    const minutes = Number(matchFull[3]);
    if (logDate === workDate) {
      return (hours * 60) + minutes;
    }
    const d1 = new Date(`${workDate}T00:00:00+09:00`);
    const d2 = new Date(`${logDate}T00:00:00+09:00`);
    const diffDays = Math.round((d2.getTime() - d1.getTime()) / (24 * 60 * 60 * 1000));
    return (diffDays * 24 * 60) + (hours * 60) + minutes;
  }

  const matchTime = text.match(/^(\d{2}):(\d{2})/);
  if (matchTime) {
    return (Number(matchTime[1]) * 60) + Number(matchTime[2]);
  }

  return null;
}

function buildActualCheckoutLookup(logs) {
  const grouped = new Map();

  for (const log of logs || []) {
    const empNo = String(log.empNo || '').trim();
    const workDate = log.isAdjusted
      ? String(log.workDate || '').trim()
      : getEffectiveWorkDate(log.logTime || log.workDate || '');
    if (!empNo || !workDate) continue;

    const key = `${empNo}_${workDate}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(log);
  }

  const lookup = new Map();

  for (const [key, dayLogs] of grouped.entries()) {
    const sorted = [...dayLogs].sort((a, b) => {
      return String(a.logTime || '').localeCompare(String(b.logTime || ''));
    });

    const firstLog = sorted[0];
    const lastLog = sorted[sorted.length - 1];
    const hasDistinctCheckout = sorted.length >= 2 && String(firstLog?.logTime || '') !== String(lastLog?.logTime || '');
    const corrected = [...sorted].reverse().find((log) => String(log.correctedOutTime || '').trim());

    let checkout = '';
    if (corrected) {
      checkout = String(corrected.correctedOutTime || '').trim();
    } else if (hasDistinctCheckout) {
      checkout = String(lastLog?.logTime || '').trim();
    }

    lookup.set(key, checkout || '-');
  }

  return lookup;
}

function getCheckoutRowKeys(row) {
  const name = normalizeName(row.employeeName);
  const prefix = normalizeNamePrefix(row.employeeName);
  const keys = [];
  if (name) keys.push(name);
  if (prefix && prefix !== name) keys.push(prefix);
  return keys;
}

export async function POST(request) {
  try {
    const session = await verifySession(request);
    if (!session) {
      return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
    }
    if (!session.isAdmin) {
      return NextResponse.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: '업로드할 파일을 선택해 주세요.' }, { status: 400 });
    }

    if (Number(file.size) > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: '파일 크기는 10MB 이하만 업로드할 수 있습니다.' }, { status: 413 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: '파일 크기는 10MB 이하만 업로드할 수 있습니다.' }, { status: 413 });
    }
    const { sheetName, headers, rows: rawRows } = parseWorkbookRows(buffer);

    const months = new Set();
    const normalizedRows = rawRows
      .map((row, index) => {
        const rideTimeRaw = String(row.rideTime || '').trim();
        const rideTime = formatRideLabel(rideTimeRaw);
        const rideDate = parseRideDate(rideTimeRaw);
        const auditWorkDate = getEffectiveWorkDate(rideTimeRaw);
        if (rideDate?.date) months.add(getMonthFromDate(rideDate.date));
        if (auditWorkDate) months.add(getMonthFromDate(auditWorkDate));

        return {
          id: `${index}-${String(row.ticketNo || '').trim()}`,
          ticketNo: String(row.ticketNo || '').trim(),
          rideTimeRaw,
          rideTime,
          employeeName: String(row.employeeName || '').trim(),
          dept: String(row.dept || '').trim(),
          reason: String(row.reason || '').trim(),
          amount: String(row.amount || '').trim(),
          settleAmount: String(row.settleAmount || '').trim(),
          status: String(row.status || '').trim(),
          pickup: String(row.pickup || '').trim(),
          dropoff: String(row.dropoff || '').trim(),
          auditWorkDate,
          isLateNightRide: isLateNightRide(rideDate),
        };
      })
      .filter((row) => row.isLateNightRide);

    const uniqueMonths = [...months].filter(Boolean);
    const employeeByEmpNo = new Map();
    const employeesByName = new Map();
    const checkoutLookupByEmpNo = new Map();

    for (const month of uniqueMonths) {
      const { logs = [], employees = [] } = await fetchAttendanceLogs(month);

      for (const emp of employees || []) {
        employeeByEmpNo.set(String(emp.empNo || '').trim(), {
          empNo: String(emp.empNo || '').trim(),
          name: String(emp.name || '').trim(),
          dept: String(emp.dept || '').trim(),
        });
        const exactName = normalizeName(emp.name);
        const prefixName = normalizeNamePrefix(emp.name);
        if (exactName) {
          if (!employeesByName.has(exactName)) employeesByName.set(exactName, []);
          employeesByName.get(exactName).push(emp);
        }
        if (prefixName) {
          if (!employeesByName.has(prefixName)) employeesByName.set(prefixName, []);
          employeesByName.get(prefixName).push(emp);
        }
      }

      const monthLookup = buildActualCheckoutLookup(logs);
      for (const [key, value] of monthLookup.entries()) {
        if (!checkoutLookupByEmpNo.has(key)) {
          checkoutLookupByEmpNo.set(key, value);
        }
      }
    }

    const checkoutLookupByName = new Map();
    for (const [empKey, checkoutTime] of checkoutLookupByEmpNo.entries()) {
      const [empNo, workDate] = String(empKey || '').split('_');
      if (!empNo || !workDate) continue;
      const emp = employeeByEmpNo.get(empNo);
      if (!emp) continue;
      const exactNameKey = `${normalizeName(emp.name)}|${workDate}`;
      const prefixNameKey = `${normalizeNamePrefix(emp.name)}|${workDate}`;
      if (!checkoutLookupByName.has(exactNameKey)) checkoutLookupByName.set(exactNameKey, checkoutTime);
      if (!checkoutLookupByName.has(prefixNameKey)) checkoutLookupByName.set(prefixNameKey, checkoutTime);
    }

    const mappedRows = normalizedRows.map((row) => {
      const keys = getCheckoutRowKeys(row);
      const auditWorkDate = row.auditWorkDate || '';
      const lookupKeys = keys.flatMap((key) => [
        `${key}|${auditWorkDate}`,
        `${normalizeNamePrefix(row.employeeName)}|${auditWorkDate}`,
      ]);
      const matchedKey = lookupKeys.find((key) => checkoutLookupByName.has(key));
      const actualOutTime = matchedKey ? checkoutLookupByName.get(matchedKey) : '-';
      const actualOutMinutes = actualOutTime && actualOutTime !== '-'
        ? getCheckoutMinutesRelative(actualOutTime, auditWorkDate)
        : null;
      const matchedEmployeeList = employeesByName.get(normalizeName(row.employeeName)) || employeesByName.get(normalizeNamePrefix(row.employeeName)) || [];
      const matchedEmployee = matchedEmployeeList[0] || null;

      return {
        ...row,
        empNo: matchedEmployee ? String(matchedEmployee.empNo || '').trim() : '',
        actualOutTime,
        actualOutMinutes,
      };
    })
      .filter((row) => Number.isFinite(row.actualOutMinutes) && row.actualOutMinutes < LATE_NIGHT_RIDE_MINUTES)
      .sort(compareByDateThenTime);

    const orderIds = mappedRows.map((r) => r.orderId || r.id || r.ticketNo).filter(Boolean);
    const { fetchTaxiExplanationsMap } = await import('@/lib/taxiExplanationDb');
    const expMap = await fetchTaxiExplanationsMap(orderIds);

    const enrichedRows = mappedRows.map((row) => {
      const orderId = row.orderId || row.id || row.ticketNo;
      const exp = expMap.get(orderId);
      return {
        ...row,
        explanationRecord: exp || null,
        explanationStatus: exp?.status || 'NONE',
        explanationText: exp?.explanation_text || '',
        explanationSubmittedAt: exp?.submitted_at || null,
        explanationRequestedAt: exp?.requested_at || null,
      };
    });

    return NextResponse.json({
      success: true,
      sheetName,
      headers,
      totalRows: enrichedRows.length,
      rows: enrichedRows,
      message: `${file.name || '파일'}을 불러왔습니다.`,
    });

  } catch (error) {
    console.error('[Taxi audit preview]', error);
    return NextResponse.json({ error: publicErrorMessage(error, '파일을 불러오지 못했습니다.') }, { status: 500 });
  }
}
