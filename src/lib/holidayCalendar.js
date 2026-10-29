import { buildFallbackHolidayMap } from './holidayFallback.mjs';

const holidayYearCache = new Map();
const fallbackYearCache = new Map();
let holidayVersion = 0;
const listeners = new Set();

const formatDateKeyInKst = (date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

const toDateKey = (value) => {
  if (!value) return '';
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : formatDateKeyInKst(value);
  }

  const text = String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? '' : formatDateKeyInKst(parsed);
};

const normalizeYearKey = (year) => String(Number(year) || '').trim();

const emitChange = () => {
  holidayVersion += 1;
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.error('[holidayCalendar] listener error', error);
    }
  });
};

const buildFallbackYearCache = (year) => {
  const yearKey = normalizeYearKey(year);
  if (!yearKey) return {};
  if (!fallbackYearCache.has(yearKey)) fallbackYearCache.set(yearKey, buildFallbackHolidayMap(Number(yearKey)));
  return fallbackYearCache.get(yearKey);
};

export function subscribeHolidayCalendar(listener) {
  if (typeof listener !== 'function') return () => {};
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getHolidayCalendarVersion() {
  return holidayVersion;
}

export function getHolidayYearCache(year) {
  return holidayYearCache.get(normalizeYearKey(year)) || {};
}

export function hasHolidayYearCache(year) {
  return holidayYearCache.has(normalizeYearKey(year));
}

export function applyHolidayYearCache(year, holidayMap = {}) {
  const yearKey = normalizeYearKey(year);
  if (!yearKey) return;

  const next = {};

  Object.entries(holidayMap || {}).forEach(([dateKey, holidayName]) => {
    const normalizedDateKey = toDateKey(dateKey);
    const name = String(holidayName || '').trim();
    if (!normalizedDateKey || !name) return;
    next[normalizedDateKey] = name;
  });

  holidayYearCache.set(yearKey, next);
  emitChange();
}

export function applyHolidayDateMap(dateMap = {}) {
  const grouped = new Map();
  Object.entries(dateMap || {}).forEach(([dateKey, holidayName]) => {
    const normalizedDateKey = toDateKey(dateKey);
    const name = String(holidayName || '').trim();
    if (!normalizedDateKey || !name) return;
    const yearKey = normalizedDateKey.slice(0, 4);
    if (!grouped.has(yearKey)) grouped.set(yearKey, {});
    grouped.get(yearKey)[normalizedDateKey] = name;
  });

  grouped.forEach((map, yearKey) => {
    const current = holidayYearCache.get(yearKey) || {};
    holidayYearCache.set(yearKey, { ...current, ...map });
  });

  if (grouped.size > 0) emitChange();
}

export function getHolidayNameByDate(dateStr) {
  const dateKey = toDateKey(dateStr);
  if (!dateKey) return null;
  const yearKey = dateKey.slice(0, 4);
  const yearCache = holidayYearCache.get(yearKey);
  return yearCache ? (yearCache[dateKey] || null) : (buildFallbackYearCache(yearKey)?.[dateKey] || null);
}

export function getHolidayDateMapByYear(year) {
  return { ...getHolidayYearCache(year) };
}
