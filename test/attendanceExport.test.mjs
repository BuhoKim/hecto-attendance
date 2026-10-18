import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttendanceExportRows,
  buildAttendanceTableRows,
  getSelectedMonths,
} from '../src/lib/attendanceExport.js';
import { applyAttendanceSheetStyles, ATTENDANCE_WORKBOOK_COLUMN_WIDTHS, getAttendanceWorkbookRows } from '../src/lib/attendanceWorkbook.js';
import StyledXLSX from 'xlsx-js-style';

test('buildAttendanceExportRows creates one daily row per employee with monthly attendance cells', () => {
  const rows = buildAttendanceExportRows({
    month: '2026-08',
    employees: [
      { empNo: '001', name: '홍길동', dept: '개발팀' },
      { empNo: '002', name: '김철수', dept: '영업팀' },
    ],
    logs: [
      { empNo: '001', workDate: '2026-08-03', logTime: '2026-08-03 08:55:00', isLate: true },
      { empNo: '001', workDate: '2026-08-03', logTime: '2026-08-03 18:02:00' },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].사번, '001');
  assert.equal(rows[0].이름, '홍길동');
  assert.equal(rows[0].부서, '개발팀');
  assert.equal(rows[0]['08/03(월)'], '08:55\n18:02');
  assert.equal(rows[0]['08/04(화)'], '');
  assert.equal(rows[1]['08/03(월)'], '');
});

test('getSelectedMonths returns sorted unique year-month keys', () => {
  assert.deepEqual(getSelectedMonths(2026, [12, 2, 2, 1]), ['2026-01', '2026-02', '2026-12']);
});

test('buildAttendanceTableRows returns dated records within the selected range', () => {
  const rows = buildAttendanceTableRows({
    fromDate: '2026-08-03',
    toDate: '2026-08-04',
    employees: [
      { empNo: '001', name: '홍길동', dept: '개발팀' },
      { name: '사번없음', dept: '개발팀' },
      { empNo: '002', name: '김철수', dept: '개발팀' },
    ],
    logs: [
      { empNo: '001', workDate: '2026-08-03', logTime: '2026-08-03 08:55:00', isLate: true },
      { empNo: '001', workDate: '2026-08-03', logTime: '2026-08-03 18:02:00' },
      { empNo: '002', workDate: '2026-08-03', logTime: '2026-08-03 09:01:00' },
      { empNo: '999', workDate: '2026-08-03', logTime: '2026-08-03 09:02:00' },
      { empNo: '001', workDate: '2026-08-10', logTime: '2026-08-10 09:00:00' },
    ],
    leaves: [{ empNo: '001', startDate: '2026-08-04', endDate: '2026-08-04', type: '연차' }],
  });

  assert.deepEqual(rows, [
    { 날짜: '2026-08-03', 이름: '김철수', 부서: '개발팀', 출근: '09:01', 퇴근: '', 상태: '정상', 비고: '', 연차사용내역: '' },
    { 날짜: '2026-08-03', 이름: '홍길동', 부서: '개발팀', 출근: '08:55', 퇴근: '18:02', 상태: '지각', 비고: '', 연차사용내역: '' },
    { 날짜: '2026-08-04', 이름: '홍길동', 부서: '개발팀', 출근: '', 퇴근: '', 상태: '연차', 비고: '휴가', 연차사용내역: '연차' },
  ]);
});

test('applyAttendanceSheetStyles highlights late rows and styles the header', () => {
  const sheet = {
    A1: { v: '날짜' }, B1: { v: '이름' }, F1: { v: '상태' },
    A2: { v: '2026-08-03' }, B2: { v: '홍길동' }, F2: { v: '지각' },
    A3: { v: '2026-08-04' }, B3: { v: '김철수' }, F3: { v: '정상' },
  };

  applyAttendanceSheetStyles(sheet, { rowCount: 3, columnCount: 6 });

  assert.equal(sheet.A1.s.font.bold, true);
  assert.equal(sheet.A1.s.fill.fgColor.rgb, '1F4E78');
  assert.equal(sheet.A2.s.fill.fgColor.rgb, 'FFF8D6');
  assert.equal(sheet.A3.s.fill.fgColor.rgb, 'F8FAFC');
  assert.deepEqual(sheet['!autofilter'], { ref: 'A1:F3' });
});

test('styled workbook writer preserves attendance cell styles', () => {
  const sheet = StyledXLSX.utils.json_to_sheet([
    { 날짜: '2026-08-03', 이름: '홍길동', 부서: '개발팀', 출근: '08:55', 퇴근: '18:02', 상태: '지각' },
  ]);
  applyAttendanceSheetStyles(sheet, { rowCount: 2, columnCount: 6 });
  const workbook = StyledXLSX.utils.book_new();
  StyledXLSX.utils.book_append_sheet(workbook, sheet, '2026-08');
  const bytes = StyledXLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  assert.ok(bytes.length > 0);
  assert.equal(sheet.A1.s.fill.fgColor.rgb, 'FF1F4E78');
});

test('getAttendanceWorkbookRows excludes the empty note column without changing display rows', () => {
  const rows = [{ 날짜: '2026-08-03', 이름: '홍길동', 부서: '개발팀', 출근: '08:55', 퇴근: '18:02', 상태: '지각', 비고: '', 연차사용내역: '' }];
  assert.deepEqual(getAttendanceWorkbookRows(rows), [{ 날짜: '2026-08-03', 이름: '홍길동', 부서: '개발팀', 출근: '08:55', 퇴근: '18:02', 상태: '지각', 연차사용내역: '' }]);
  assert.equal(rows[0].비고, '');
});

test('attendance workbook gives the status column enough width for leave labels', () => {
  assert.equal(ATTENDANCE_WORKBOOK_COLUMN_WIDTHS[5], 24);
});

test('buildAttendanceTableRows shows leave_name from the attendance API in the annual leave column', () => {
  const rows = buildAttendanceTableRows({
    fromDate: '2026-08-04',
    toDate: '2026-08-04',
    employees: [{ empNo: '001', name: '홍길동', dept: '개발팀' }],
    leaves: [{ emp_no: '001', start_date: '2026-08-04', end_date: '2026-08-04', leave_code: '51', leave_name: '51', leave_days: 1 }],
  });

  assert.equal(rows[0].상태, '연차');
  assert.equal(rows[0].연차사용내역, '연차');
});

test('buildAttendanceTableRows matches compact DB leave dates', () => {
  const rows = buildAttendanceTableRows({
    fromDate: '2026-08-04',
    toDate: '2026-08-04',
    employees: [{ empNo: '001', name: '홍길동', dept: '개발팀' }],
    leaves: [{ empNo: '001', startDate: '20260804', endDate: '20260804', leaveName: '연차' }],
  });

  assert.equal(rows[0].연차사용내역, '연차');
});

test('buildAttendanceTableRows excludes leave records for employees missing from the employee list', () => {
  const rows = buildAttendanceTableRows({
    fromDate: '2026-08-03',
    toDate: '2026-08-03',
    employees: [{ empNo: '001', name: '홍길동', dept: '개발팀' }],
    leaves: [
      { empNo: '999', startDate: '2026-08-03', endDate: '2026-08-03', leaveName: '연차' },
    ],
  });

  assert.deepEqual(rows, []);
});
