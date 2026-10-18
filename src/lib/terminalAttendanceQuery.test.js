import test from 'node:test';
import assert from 'node:assert/strict';
import { buildATimeBounds, filterTerminalRows, findMissingOvernightRows, summarizeMissingOvernightRows } from './terminalAttendanceQuery.js';

test('builds local a_time bounds without UTC conversion', () => {
  assert.deepEqual(buildATimeBounds({ from: '2026-09-01', to: '2026-09-30', fromTime: '19:00', toTime: '23:59' }), {
    from: '20260901190000', to: '20260930235959',
  });
});

test('filters by selected terminal and local time', () => {
  const rows = [
    { a_time: '20260901185959', eq_code: '5005' },
    { a_time: '20260901190000', eq_code: '5005' },
    { a_time: '20260901200000', eq_code: '1000' },
  ];
  assert.equal(filterTerminalRows(rows, { terminalCodes: ['5005', '5006'], fromTime: '19:00' }).length, 1);
});

test('finds 5005 entries from 17:00 to 18:00 without overnight records', () => {
  const rows = [
    { emp_no: 'A', a_time: '20260901170000', eq_code: '5005' },
    { emp_no: 'A', a_time: '20260902020000', eq_code: '5005' },
    { emp_no: 'B', a_time: '20260901175959', eq_code: '5005' },
  ];
  assert.deepEqual(findMissingOvernightRows(rows).map((row) => row.emp_no), ['B']);
});

test('summarizes both terminal times and the final same-day access time', () => {
  const rows = [
    { emp_no: 'A', a_time: '20260901121300', eq_code: '5005' },
    { emp_no: 'A', a_time: '20260901170000', eq_code: '5005' },
    { emp_no: 'A', a_time: '20260901173500', eq_code: '5006' },
    { emp_no: 'A', a_time: '20260901190400', eq_code: '1000' },
  ];
  assert.deepEqual(summarizeMissingOvernightRows(rows, new Map([['A', { name: '홍길동', dept: '사업개발팀' }]]), { candidateTerminals: ['5005', '5006'] }), [{ date: '2026-09-01', empNo: 'A', name: '홍길동', dept: '사업개발팀', candidateTimes: '17:00, 17:35', lastTime: '19:04' }]);
});

test('includes a candidate record at 18:29 when the window ends at 18:30', () => {
  const rows = [{ emp_no: 'A', a_time: '20260901182900', eq_code: '5006' }];
  assert.equal(findMissingOvernightRows(rows, { candidateTerminals: ['5005', '5006'], candidateEnd: '18:30' }).length, 1);
});
