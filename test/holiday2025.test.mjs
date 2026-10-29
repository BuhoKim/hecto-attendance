import test from 'node:test';
import assert from 'node:assert/strict';
import { getHolidayNameByDate, applyHolidayYearCache } from '../src/lib/holidayCalendar.js';
import { buildFallbackHolidayMap } from '../src/lib/holidayFallback.mjs';
import { isDateHoliday } from '../src/lib/leaveRules.js';

test('2025 lunar new year fallback matches the official holiday dates', () => {
  assert.equal(getHolidayNameByDate('2025-01-27'), '임시공휴일');
  assert.equal(getHolidayNameByDate('2025-01-28'), '설날 연휴');
  assert.equal(getHolidayNameByDate('2025-01-29'), '설날');
  assert.equal(getHolidayNameByDate('2025-01-30'), '설날 연휴');
  assert.equal(getHolidayNameByDate('2025-01-31'), null);
});

test('verified holiday dates and adjacent ordinary days for 2025–2027', () => {
  const expected = {
    2025: ['01-01','01-27','01-28','01-29','01-30','03-01','03-03','05-01','05-05','05-06','06-03','06-06','08-15','10-03','10-05','10-06','10-07','10-08','10-09','12-25'],
    2026: ['01-01','02-16','02-17','02-18','03-01','03-02','05-01','05-05','05-24','05-25','06-03','06-06','07-17','08-15','08-17','09-24','09-25','09-26','10-03','10-05','10-09','12-25'],
    2027: ['01-01','02-06','02-07','02-08','02-09','03-01','05-01','05-03','05-05','05-13','06-06','07-17','07-19','08-15','08-16','09-14','09-15','09-16','10-03','10-04','10-09','10-11','12-25','12-27'],
  };
  for (const [year, dates] of Object.entries(expected)) assert.deepEqual(Object.keys(buildFallbackHolidayMap(year)).sort(), dates.map(d => `${year}-${d}`).sort());
  assert.equal(isDateHoliday('2025-05-15'), false);
  assert.equal(isDateHoliday('2026-07-17'), true);
});

test('authoritative yearly response replaces fallback instead of retaining phantom dates', () => {
  applyHolidayYearCache(2025, {'2025-01-29':'설날'});
  assert.equal(getHolidayNameByDate('2025-01-31'), null);
  assert.equal(getHolidayNameByDate('2025-01-28'), null);
  applyHolidayYearCache(2025, buildFallbackHolidayMap(2025));
  assert.ok(getHolidayNameByDate('2025-01-28'));
});

test('unverified years exclude observances and calculate lunar new year around the lunar date', () => {
  const map = buildFallbackHolidayMap(2024);
  for (const date of ['2024-02-09','2024-02-10','2024-02-11']) assert.ok(map[date]);
  assert.equal(map['2024-02-12'], undefined);
  assert.equal(map['2024-07-17'], undefined);
});
