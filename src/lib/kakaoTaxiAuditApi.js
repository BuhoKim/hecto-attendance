import crypto from 'node:crypto';
import { fetchAttendanceLogs } from './supabaseDb';
import { shiftKstDateKey } from './kstDate';
import { normalizeEmpNoKey } from './dashboardUtils';
import { isExcludedTaxiOrderStatus, normalizeTaxiOrderStatus } from './kakaoTaxiStatus';

const DEFAULT_BASE_URL = process.env.KAKAO_T_BIZ_API_BASE_URL || 'https://b2b-api.kakaomobility.com';
const EARLY_MORNING_CUTOFF = 6 * 60;
const LATE_NIGHT_CUTOFF = 22 * 60;

const normalizeText = (value = '') => String(value || '').trim().replace(/\s+/g, '').toLowerCase();
const normalizeName = (value = '') => normalizeText(value);
const normalizeNamePrefix = (value = '') => normalizeName(value).slice(0, 3);

const resolveKakaoAuthConfig = () => {
  const corpId =
    process.env.KAKAO_T_BIZ_CORP_ID
    || process.env.KAKAO_T_BIZ_CORP_ID_VALUE
    || process.env.KAKAO_T_BIZ_ID
    || process.env.KAKAO_T_BIZ_COMPANY_ID
    || '';
  const secret =
    process.env.KAKAO_T_BIZ_API_SECRET
    || process.env.KAKAO_T_BIZ_SECRET
    || process.env.KAKAO_T_BIZ_TOKEN
    || process.env.KAKAO_T_BIZ_API_KEY
    || process.env.KAKAO_T_BIZ_AUTH_SECRET
    || '';

  return {
    corpId: String(corpId || '').trim(),
    secret: String(secret || '').trim(),
  };
};

const buildKakaoAuthHeaders = ({ corpId, secret, method, requestUrl }) => {
  if (!corpId || !secret) {
    throw new Error('카카오T API 설정이 부족합니다. KAKAO_T_BIZ_CORP_ID, KAKAO_T_BIZ_API_SECRET를 확인하세요.');
  }

  const nonce = String(crypto.randomInt(10000, 99999));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const canonicalUrl = `${requestUrl.origin}${requestUrl.pathname}`;
  const message = `${nonce}\n${canonicalUrl}\n${method}\n${corpId}\n${timestamp}\n${nonce}`;
  const token = crypto.createHmac('sha1', secret).update(message).digest('base64');

  return {
    authorization: `Token ${token}`,
    'x-mob-b2b-corp-id': corpId,
    'x-mob-b2b-nonce': nonce,
    'x-mob-b2b-timestamp': timestamp,
  };
};

const parseDateTime = (value = '') => {
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
};

const formatDateTime = (value = '') => {
  const parsed = parseDateTime(value);
  if (!parsed) return String(value || '-').trim() || '-';
  return `${parsed.date} ${String(parsed.hours).padStart(2, '0')}:${String(parsed.minutes).padStart(2, '0')}`;
};

const toMinutes = (value = '') => {
  const match = String(value || '').trim().match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  return (Number(match[1]) * 60) + Number(match[2]);
};

const getCheckoutMinutesRelative = (checkoutValue = '', workDate = '') => {
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
};

const getMonthKey = (dateStr = '') => String(dateStr || '').slice(0, 7);

const getAuditWorkDate = (rideValue = '') => {
  const parsed = parseDateTime(rideValue);
  if (!parsed) return '';
  const minutes = (parsed.hours * 60) + parsed.minutes;
  if (minutes < EARLY_MORNING_CUTOFF) {
    return shiftKstDateKey(parsed.date, -1);
  }
  return parsed.date;
};

const isLateNightRide = (rideValue = '') => {
  const parsed = parseDateTime(rideValue);
  if (!parsed) return false;
  const minutes = (parsed.hours * 60) + parsed.minutes;
  return minutes >= LATE_NIGHT_CUTOFF || minutes < EARLY_MORNING_CUTOFF;
};

const getOrderAmount = (order = {}) => {
  const paymentItems = Array.isArray(order.payment_items) ? order.payment_items : [];
  const paidAmounts = paymentItems
    .filter((item) => String(item?.status || '').toLowerCase() === 'paid')
    .map((item) => Number(item?.amount || 0))
    .filter((amount) => Number.isFinite(amount));

  if (paidAmounts.length > 0) {
    return paidAmounts.reduce((sum, amount) => sum + amount, 0);
  }

  const fallback = Number(order.service_fare || 0) + Number(order.toll || 0) + Number(order.platform_fee || 0);
  return Number.isFinite(fallback) ? fallback : 0;
};

const getOrderStatus = (order = {}, paymentItems = []) => {
  const orderStatus = order.status || order.order_status || order.payment_status;
  if (orderStatus) return String(orderStatus).trim();
  const itemStatuses = paymentItems.map((item) => String(item?.status || '').trim()).filter(Boolean);
  return itemStatuses[0] || '';
};

const buildActualCheckoutLookup = (logs = []) => {
  const grouped = new Map();

  for (const log of logs || []) {
    const empNo = String(log.empNo || '').trim();
    const workDate = log.isAdjusted
      ? String(log.workDate || '').trim()
      : getAuditWorkDate(log.logTime || log.workDate || '');
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
};

async function fetchKakaoTaxiOrdersPage({
  startDate,
  endDate,
  page = 1,
  per = 100,
  memberIdentifier = '',
} = {}) {
  const { corpId, secret } = resolveKakaoAuthConfig();

  const baseUrl = process.env.KAKAO_T_BIZ_API_BASE_URL || DEFAULT_BASE_URL;
  const requestUrl = new URL('/external/v2/orders', baseUrl);
  requestUrl.searchParams.set('start_date', startDate);
  requestUrl.searchParams.set('end_date', endDate);
  requestUrl.searchParams.set('page', String(page));
  requestUrl.searchParams.set('per', String(Math.min(100, Math.max(1, per))));
  requestUrl.searchParams.set('search_by_payment_at', 'false');
  requestUrl.searchParams.set('vertical_code', 'TAXI');
  if (memberIdentifier) {
    requestUrl.searchParams.set('member_identifier', memberIdentifier);
  }

  const headers = buildKakaoAuthHeaders({
    corpId,
    secret,
    method: 'GET',
    requestUrl,
  });

  const res = await fetch(requestUrl.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json;charset=UTF-8',
      ...headers,
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`카카오T API 조회 실패 (${res.status}): ${text || res.statusText}`);
  }

  return res.json();
}

export async function fetchKakaoTaxiOrders({
  startDate,
  endDate,
  memberIdentifier = '',
  per = 100,
} = {}) {
  if (!startDate || !endDate) {
    throw new Error('조회 시작일과 종료일을 입력해 주세요.');
  }

  const orders = [];
  let totalCount = 0;
  let page = 1;
  const pageSize = Math.min(100, Math.max(1, per));

  while (orders.length < totalCount || (totalCount === 0 && page === 1)) {
    const json = await fetchKakaoTaxiOrdersPage({
      startDate,
      endDate,
      page,
      per: pageSize,
      memberIdentifier,
    });

    const pageOrders = Array.isArray(json?.orders) ? json.orders : [];
    totalCount = Number(json?.count || 0);
    orders.push(...pageOrders);

    if (pageOrders.length === 0 || orders.length >= totalCount || pageOrders.length < pageSize) {
      break;
    }

    page += 1;
  }

  return {
    count: totalCount || orders.length,
    orders,
  };
}

export async function buildTaxiAuditRowsFromKakao({
  startDate,
  endDate,
  memberIdentifier = '',
} = {}) {
  const { orders, count } = await fetchKakaoTaxiOrders({
    startDate,
    endDate,
    memberIdentifier,
  });

  const normalizedOrders = (orders || [])
    .map((order, index) => {
      const rideTimeRaw = String(order.departure_time || order.call_time || '').trim();
      const rideDate = parseDateTime(rideTimeRaw);
      const auditWorkDate = getAuditWorkDate(rideTimeRaw);
      const memberIdentifierValue = String(order.member_identifier || '').trim();
      const memberNameValue = String(order.member_name || '').trim();
      const amount = getOrderAmount(order);
      const paymentItems = Array.isArray(order.payment_items) ? order.payment_items : [];
      const paidItem = paymentItems.find((item) => String(item?.status || '').toLowerCase() === 'paid') || paymentItems[0] || null;
      const orderStatus = getOrderStatus(order, paymentItems);

      return {
        id: String(order.id || `${index}`),
        orderId: String(order.id || '').trim(),
        ticketNo: String(order.id || '').trim(),
        rideTimeRaw,
        rideTime: formatDateTime(rideTimeRaw),
        callTime: formatDateTime(String(order.call_time || '').trim()),
        arrivalTime: formatDateTime(String(order.arrival_time || order.dropoff_time || order.completed_time || order.end_time || '').trim()),
        rideDate,
        employeeName: memberNameValue,
        dept: String(order.member_department || '').trim(),
        reason: String(order.use_code || order.vertical_product_name || '택시 이용').trim(),
        amount: String(amount),
        settleAmount: String(amount),
        status: orderStatus,
        pickup: String(order.departure_point || '').trim(),
        dropoff: String(order.arrival_point || '').trim(),
        memberIdentifier: memberIdentifierValue,
        memberDepartment: String(order.member_department || '').trim(),
        verticalCode: String(order.vertical_code || '').trim(),
        verticalProductCode: String(order.vertical_product_code || '').trim(),
        verticalProductName: String(order.vertical_product_name || '').trim(),
        taxiKind: String(order.taxi_kind || '').trim(),
        useCode: String(order.use_code || '').trim(),
        groupId: String(order.group_id || '').trim(),
        groupName: String(order.group_name || '').trim(),
        carModel: String(order.car_model || '').trim(),
        carNumber: String(order.car_number || '').trim(),
        paymentItems,
        paymentApprovalNo: String(paidItem?.approval_no || '').trim(),
        paymentDateTime: String(paidItem?.org_date_time || '').trim(),
        auditWorkDate,
        isLateNightRide: isLateNightRide(rideTimeRaw),
        rawOrder: order,
      };
    })
    .filter((row) => row.isLateNightRide);

  const excludedRows = normalizedOrders.filter((row) => isExcludedTaxiOrderStatus(row.status));

  const months = new Set();
  normalizedOrders.forEach((row) => {
    if (row.rideDate?.date) months.add(getMonthKey(row.rideDate.date));
    if (row.auditWorkDate) months.add(getMonthKey(row.auditWorkDate));
  });

  const employeeByEmpNo = new Map();
  const employeesByName = new Map();
  const checkoutLookupByEmpNo = new Map();

  for (const month of [...months].filter(Boolean)) {
    const { logs = [], employees = [] } = await fetchAttendanceLogs(month);

    for (const emp of employees || []) {
      const empNo = String(emp.empNo || '').trim();
      const name = String(emp.name || '').trim();
      const dept = String(emp.dept || '').trim();
      if (empNo) {
        employeeByEmpNo.set(empNo, { empNo, name, dept });
      }

      const exactName = normalizeName(name);
      const prefixName = normalizeNamePrefix(name);

      if (exactName) {
        if (!employeesByName.has(exactName)) employeesByName.set(exactName, []);
        employeesByName.get(exactName).push({ empNo, name, dept });
      }
      if (prefixName) {
        if (!employeesByName.has(prefixName)) employeesByName.set(prefixName, []);
        employeesByName.get(prefixName).push({ empNo, name, dept });
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

  const rows = normalizedOrders
    .filter((row) => !isExcludedTaxiOrderStatus(row.status))
    .map((row) => {
      const normalizedIdentifier = normalizeEmpNoKey(row.memberIdentifier);
      const directEmp = normalizedIdentifier ? employeeByEmpNo.get(normalizedIdentifier) : null;
      const matchedByNameList = employeesByName.get(normalizeName(row.employeeName))
        || employeesByName.get(normalizeNamePrefix(row.employeeName))
        || [];
      const matchedEmployee = directEmp || matchedByNameList[0] || null;
      const employeeName = matchedEmployee?.name || row.employeeName || '';
      const dept = matchedEmployee?.dept || row.dept || '';
      const empNo = matchedEmployee?.empNo || normalizedIdentifier || '';

      const lookupKeys = [
        `${empNo}_${row.auditWorkDate}`,
        `${normalizeName(employeeName)}|${row.auditWorkDate}`,
        `${normalizeNamePrefix(employeeName)}|${row.auditWorkDate}`,
      ].filter(Boolean);
      const matchedKey = lookupKeys.find((key) => checkoutLookupByEmpNo.has(key) || checkoutLookupByName.has(key));
      const actualOutTime = matchedKey
        ? (checkoutLookupByEmpNo.get(matchedKey) || checkoutLookupByName.get(matchedKey))
        : '-';
      const actualOutMinutes = actualOutTime && actualOutTime !== '-'
        ? getCheckoutMinutesRelative(actualOutTime, row.auditWorkDate)
        : null;

      return {
        ...row,
        empNo,
        employeeName,
        dept,
        actualOutTime,
        actualOutMinutes,
      };
    })
    .filter((row) => Number.isFinite(row.actualOutMinutes) && row.actualOutMinutes < LATE_NIGHT_CUTOFF)
    .sort((a, b) => String(a.auditWorkDate || '').localeCompare(String(b.auditWorkDate || ''))
      || String(a.rideTimeRaw || '').localeCompare(String(b.rideTimeRaw || ''))
      || String(a.employeeName || '').localeCompare(String(b.employeeName || '')));

  return {
    count,
    rows,
    meta: {
      queriedMonths: [...months].filter(Boolean),
      matchedRows: rows.length,
      excludedRows: excludedRows.length,
      excludedAmount: excludedRows.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      source: 'kakao',
    },
  };
}

export async function fetchKakaoTaxiReportData({
  startDate,
  endDate,
  memberIdentifier = '',
  filterDept = '',
  allowedDepts = null,
} = {}) {
  const { orders, count } = await fetchKakaoTaxiOrders({
    startDate,
    endDate,
    memberIdentifier,
  });

  const months = new Set();
  const rawNormalized = (orders || []).map((order, index) => {
    const rideTimeRaw = String(order.departure_time || order.call_time || '').trim();
    const rideDate = parseDateTime(rideTimeRaw);
    if (rideDate?.date) months.add(getMonthKey(rideDate.date));

    const amount = getOrderAmount(order);
    const platformFee = Number(order.platform_fee || 0);

    const paymentItems = Array.isArray(order.payment_items) ? order.payment_items : [];
    const paidItem = paymentItems.find((item) => String(item?.status || '').toLowerCase() === 'paid') || paymentItems[0] || null;
    const orderStatus = getOrderStatus(order, paymentItems);

    const extraFeeFromItems = paymentItems
      .filter((item) => {
        const name = String(item?.name || item?.item_name || '').toLowerCase();
        return name.includes('호출') || name.includes('플랫폼') || name.includes('스마트');
      })
      .reduce((sum, item) => sum + Number(item?.amount || 0), 0);

    const totalExtraFee = Math.max(platformFee, extraFeeFromItems);

    return {
      id: String(order.id || `${index}`),
      orderId: String(order.id || '').trim(),
      ticketNo: String(order.id || '').trim(),
      rideTimeRaw,
      rideTime: formatDateTime(rideTimeRaw),
      callTime: formatDateTime(String(order.call_time || '').trim()),
      arrivalTime: formatDateTime(String(order.arrival_time || order.dropoff_time || order.completed_time || order.end_time || '').trim()),
      rideDate,
      employeeName: String(order.member_name || '').trim(),
      dept: String(order.member_department || '').trim() || '미지정',
      reason: String(order.use_code || order.vertical_product_name || '택시 이용').trim(),
      amount,
      platformFee: totalExtraFee,
      hasExtraFee: totalExtraFee > 0,
      status: orderStatus,
      pickup: String(order.departure_point || '').trim(),
      dropoff: String(order.arrival_point || '').trim(),
      memberIdentifier: String(order.member_identifier || '').trim(),
      verticalProductName: String(order.vertical_product_name || '').trim(),
      taxiKind: String(order.taxi_kind || '').trim(),
      useCode: String(order.use_code || '').trim(),
      rawOrder: order,
    };
  });

  const excludedRows = rawNormalized.filter((row) => isExcludedTaxiOrderStatus(row.status));
  const excludedStatusMap = new Map();
  excludedRows.forEach((row) => {
    const status = normalizeTaxiOrderStatus(row.status) || 'unknown';
    const current = excludedStatusMap.get(status) || { status, count: 0, amount: 0 };
    current.count += 1;
    current.amount += row.amount;
    excludedStatusMap.set(status, current);
  });
  const excludedStatusStats = [...excludedStatusMap.values()].sort((a, b) => b.amount - a.amount || b.count - a.count);
  const activeRawRows = rawNormalized.filter((row) => !isExcludedTaxiOrderStatus(row.status));

  const employeeByEmpNo = new Map();
  const employeesByName = new Map();

  for (const month of [...months].filter(Boolean)) {
    const { employees = [] } = await fetchAttendanceLogs(month).catch(() => ({ employees: [] }));
    for (const emp of employees || []) {
      const empNo = String(emp.empNo || '').trim();
      const name = String(emp.name || '').trim();
      const dept = String(emp.dept || '').trim();
      if (empNo) employeeByEmpNo.set(empNo, { empNo, name, dept });
      const exactName = normalizeName(name);
      if (exactName && !employeesByName.has(exactName)) {
        employeesByName.set(exactName, { empNo, name, dept });
      }
    }
  }

  const normalizeDeptKey = (val = '') => String(val || '').replace(/\s+/g, '').trim().toLowerCase();

  const allEnrichedRows = activeRawRows.map((row) => {
    const normalizedIdentifier = normalizeEmpNoKey(row.memberIdentifier);
    const directEmp = normalizedIdentifier ? employeeByEmpNo.get(normalizedIdentifier) : null;
    const nameMatchedEmp = employeesByName.get(normalizeName(row.employeeName));
    const matched = directEmp || nameMatchedEmp;

    const dept = matched?.dept || row.dept || '미지정';
    const employeeName = matched?.name || row.employeeName || '미상';

    return {
      ...row,
      dept,
      employeeName,
    };
  });

  let scopeFilteredRows = allEnrichedRows;
  if (Array.isArray(allowedDepts) && allowedDepts.length > 0) {
    const allowedSet = new Set(allowedDepts.map((d) => normalizeDeptKey(d)));
    scopeFilteredRows = allEnrichedRows.filter((r) => allowedSet.has(normalizeDeptKey(r.dept)));
  }

  const availableDepts = [...new Set(scopeFilteredRows.map((r) => r.dept).filter(Boolean))].sort();

  let rows = scopeFilteredRows;
  if (filterDept && filterDept !== 'ALL') {
    const targetNorm = normalizeDeptKey(filterDept);
    rows = rows.filter((r) => normalizeDeptKey(r.dept) === targetNorm);
  }

  rows.sort((a, b) => String(b.rideTimeRaw || '').localeCompare(String(a.rideTimeRaw || '')));

  const totalCount = rows.length;
  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  const avgAmount = totalCount > 0 ? Math.round(totalAmount / totalCount) : 0;

  const deptMap = new Map();
  rows.forEach((r) => {
    const dept = r.dept || '미지정';
    if (!deptMap.has(dept)) {
      deptMap.set(dept, { dept, count: 0, amount: 0 });
    }
    const curr = deptMap.get(dept);
    curr.count += 1;
    curr.amount += r.amount;
  });

  const deptStats = [...deptMap.values()]
    .map((d) => ({
      ...d,
      countRatio: totalCount > 0 ? Number(((d.count / totalCount) * 100).toFixed(1)) : 0,
      amountRatio: totalAmount > 0 ? Number(((d.amount / totalAmount) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.amount - a.amount || b.count - a.count);

  let eveningCount = 0;
  let eveningAmount = 0;
  let lateNightCount = 0;
  let lateNightAmount = 0;
  let daytimeCount = 0;
  let daytimeAmount = 0;

  rows.forEach((r) => {
    const hours = r.rideDate?.hours ?? null;
    if (hours === null) return;

    if (hours >= 19 && hours < 24) {
      eveningCount += 1;
      eveningAmount += r.amount;
    } else if (hours >= 0 && hours < 6) {
      lateNightCount += 1;
      lateNightAmount += r.amount;
    } else {
      daytimeCount += 1;
      daytimeAmount += r.amount;
    }
  });

  const timeWindowStats = {
    evening: {
      label: '저녁/야근 (19:00 ~ 24:00)',
      count: eveningCount,
      amount: eveningAmount,
      countRatio: totalCount > 0 ? Number(((eveningCount / totalCount) * 100).toFixed(1)) : 0,
      amountRatio: totalAmount > 0 ? Number(((eveningAmount / totalAmount) * 100).toFixed(1)) : 0,
    },
    lateNight: {
      label: '심야/새벽 (00:00 ~ 06:00)',
      count: lateNightCount,
      amount: lateNightAmount,
      countRatio: totalCount > 0 ? Number(((lateNightCount / totalCount) * 100).toFixed(1)) : 0,
      amountRatio: totalAmount > 0 ? Number(((lateNightAmount / totalAmount) * 100).toFixed(1)) : 0,
    },
    daytime: {
      label: '주간/기타 (06:00 ~ 19:00)',
      count: daytimeCount,
      amount: daytimeAmount,
      countRatio: totalCount > 0 ? Number(((daytimeCount / totalCount) * 100).toFixed(1)) : 0,
      amountRatio: totalAmount > 0 ? Number(((daytimeAmount / totalAmount) * 100).toFixed(1)) : 0,
    },
  };

  const extraFeeRows = rows.filter((r) => r.hasExtraFee);
  const extraFeeTripCount = extraFeeRows.length;
  const extraFeeTotalAmount = rows.reduce((sum, r) => sum + r.platformFee, 0);

  const extraFeeStats = {
    tripCount: extraFeeTripCount,
    tripRatio: totalCount > 0 ? Number(((extraFeeTripCount / totalCount) * 100).toFixed(1)) : 0,
    totalFeeAmount: extraFeeTotalAmount,
    amountRatio: totalAmount > 0 ? Number(((extraFeeTotalAmount / totalAmount) * 100).toFixed(1)) : 0,
  };

  const reasonMap = new Map();
  rows.forEach((r) => {
    const reason = r.reason || '기타/미지정';
    if (!reasonMap.has(reason)) {
      reasonMap.set(reason, { reason, count: 0, amount: 0 });
    }
    const curr = reasonMap.get(reason);
    curr.count += 1;
    curr.amount += r.amount;
  });

  const reasonStats = [...reasonMap.values()]
    .map((item) => ({
      ...item,
      countRatio: totalCount > 0 ? Number(((item.count / totalCount) * 100).toFixed(1)) : 0,
      amountRatio: totalAmount > 0 ? Number(((item.amount / totalAmount) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count || b.amount - a.amount);

  const dailyMap = new Map();
  rows.forEach((r) => {
    const dateStr = r.rideDate?.date || '기타';
    if (!dailyMap.has(dateStr)) {
      dailyMap.set(dateStr, {
        date: dateStr,
        count: 0,
        amount: 0,
        eveningCount: 0,
        lateNightCount: 0,
      });
    }
    const curr = dailyMap.get(dateStr);
    curr.count += 1;
    curr.amount += r.amount;
    const hours = r.rideDate?.hours ?? null;
    if (hours !== null) {
      if (hours >= 19 && hours < 24) curr.eveningCount += 1;
      if (hours >= 0 && hours < 6) curr.lateNightCount += 1;
    }
  });

  const dailyStats = [...dailyMap.values()]
    .map((d) => ({
      ...d,
      avgAmount: d.count > 0 ? Math.round(d.amount / d.count) : 0,
    }))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    summary: {
      totalCount,
      totalAmount,
      avgAmount,
      activeDeptsCount: deptStats.length,
      activeEmployeesCount: new Set(rows.map((r) => r.employeeName)).size,
    },
    deptStats,
    timeWindowStats,
    extraFeeStats,
    excludedStatusStats,
    excludedSummary: {
      totalCount: excludedRows.length,
      totalAmount: excludedRows.reduce((sum, row) => sum + row.amount, 0),
    },
    reasonStats,
    dailyStats,
    availableDepts,
    rows,
    count,
  };
}
