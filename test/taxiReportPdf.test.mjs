import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaxiPdfRows, formatTaxiPdfDateTime, getTaxiPdfPageDimensions, getTaxiPdfTotalAmount, TAXI_PDF_COLUMN_WIDTHS, TAXI_PDF_PAGE_ROW_COUNT } from '../src/lib/taxiReportPdf.js';

test('buildTaxiPdfRows maps taxi report rows to the reference PDF table columns', () => {
  const rows = buildTaxiPdfRows([
    {
      employeeName: '김민상',
      rideTime: '2026-07-01 23:22:15',
      pickup: '서울특별시 강남구 역삼2동 역삼동리올링스',
      arrivalTime: '2026-07-02 00:00:44',
      dropoff: '서울특별시 강서구 공항동 굽네치킨 마곡1호점',
      reason: '아이온2 QA일정으로 야근',
      amount: 35000,
    },
  ]);

  assert.deepEqual(rows, [{
    no: 1,
    employeeName: '김민상',
    boardingAt: '2026-07-01\n23:22:15',
    pickup: '서울특별시 강남구 역삼2동 역삼동리올링스',
    arrivalAt: '2026-07-02\n00:00:44',
    dropoff: '서울특별시 강서구 공항동 굽네치킨 마곡1호점',
    reason: '아이온2 QA일정으로 야근',
    amount: 35000,
  }]);
});

test('buildTaxiPdfRows leaves unavailable arrival time blank', () => {
  const rows = buildTaxiPdfRows([{ employeeName: '박상진', rideTime: '2026-07-01 23:24:45', callTime: '2026-07-01 23:20:00' }]);
  assert.equal(rows[0].arrivalAt, '');
});

test('buildTaxiPdfRows sorts rows by boarding date ascending and calculates the total amount', () => {
  const rows = buildTaxiPdfRows([
    { employeeName: '박상진', rideTime: '2026-07-03 10:00:00', amount: 50000 },
    { employeeName: '김민상', rideTime: '2026-07-01 10:00:00', amount: 35000 },
  ]);

  assert.deepEqual(rows.map((row) => row.employeeName), ['김민상', '박상진']);
  assert.equal(getTaxiPdfTotalAmount(rows), 85000);
});

test('getTaxiPdfPageDimensions preserves the rendered page ratio instead of stretching short pages', () => {
  assert.deepEqual(getTaxiPdfPageDimensions(1120, 560), { width: 210, height: 105 });
});

test('taxi PDF keeps thirty rows per regular page while allowing individual rows to grow', () => {
  assert.equal(TAXI_PDF_PAGE_ROW_COUNT, 30);
});

test('taxi PDF puts the date and time on separate lines and gives locations more width', () => {
  assert.equal(formatTaxiPdfDateTime('2026-07-01 23:22:15'), '2026-07-01\n23:22:15');
  assert.deepEqual(TAXI_PDF_COLUMN_WIDTHS, [6, 9, 10, 21, 10, 21, 15, 8]);
});
