import Holidays from 'date-holidays';

// Confirmed public holidays including election/temporary days and substitutes.
// Sources: KASI calendar data and 2027 government calendar announcement.
const VERIFIED = {
  2025: {
    '01-01':'신정','01-27':'임시공휴일','01-28':'설날 연휴','01-29':'설날','01-30':'설날 연휴',
    '03-01':'삼일절','03-03':'삼일절 대체공휴일','05-01':'근로자의 날',
    '05-05':'어린이날·부처님오신날','05-06':'대체공휴일','06-03':'대통령 선거일',
    '06-06':'현충일','08-15':'광복절','10-03':'개천절','10-05':'추석 연휴',
    '10-06':'추석','10-07':'추석 연휴','10-08':'추석 대체공휴일','10-09':'한글날','12-25':'성탄절',
  },
  2026: {
    '01-01':'신정','02-16':'설날 연휴','02-17':'설날','02-18':'설날 연휴',
    '03-01':'삼일절','03-02':'삼일절 대체공휴일','05-01':'노동절','05-05':'어린이날',
    '05-24':'부처님오신날','05-25':'부처님오신날 대체공휴일','06-03':'지방선거일',
    '06-06':'현충일','07-17':'제헌절','08-15':'광복절','08-17':'광복절 대체공휴일',
    '09-24':'추석 연휴','09-25':'추석','09-26':'추석 연휴','10-03':'개천절',
    '10-05':'개천절 대체공휴일','10-09':'한글날','12-25':'성탄절',
  },
  2027: {
    '01-01':'신정','02-06':'설날 연휴','02-07':'설날','02-08':'설날 연휴',
    '02-09':'설날 대체공휴일','03-01':'삼일절','05-01':'노동절','05-03':'노동절 대체공휴일',
    '05-05':'어린이날','05-13':'부처님오신날','06-06':'현충일','07-17':'제헌절',
    '07-19':'제헌절 대체공휴일','08-15':'광복절','08-16':'광복절 대체공휴일',
    '09-14':'추석 연휴','09-15':'추석','09-16':'추석 연휴','10-03':'개천절',
    '10-04':'개천절 대체공휴일','10-09':'한글날','10-11':'한글날 대체공휴일',
    '12-25':'성탄절','12-27':'성탄절 대체공휴일',
  },
};

export function buildFallbackHolidayMap(year) {
  const y = Number(year);
  if (VERIFIED[y]) return Object.fromEntries(Object.entries(VERIFIED[y]).map(([date, name]) => [`${y}-${date}`, name]));
  const map = {};
  for (const item of new Holidays('KR').getHolidays(y) || []) {
    if (item.type !== 'public' || !item.name) continue;
    const date = String(item.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const base = Date.parse(`${date}T00:00:00Z`);
    const isNewYear = /^korean 01-0-01 P3D/.test(item.rule || '');
    const isChuseok = /^korean 8-0-14 P3D/.test(item.rule || '');
    const offsets = isNewYear ? [-1, 0, 1] : isChuseok ? [0, 1, 2] : [0];
    for (const offset of offsets) map[new Date(base + offset * 86400000).toISOString().slice(0, 10)] = item.name;
  }
  return map;
}
