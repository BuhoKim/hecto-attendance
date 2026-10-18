import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterCalendarMembers,
  buildNaverCalendarMembersPayload,
  validateCalendarConfigPayload,
  formatCalendarDate,
  getNextCalendarDay,
  getLeaveLabel,
  buildLeaveEventPayload,
  parseLeaveKeyFromDescription,
} from '../src/lib/naverCalendarRules.mjs';

test('filterCalendarMembers는 퇴사자, 비활성 직원, 제외 지정된 사번을 필터링한다', () => {
  const employees = [
    { emp_no: '20200001', name: '홍길동', dept: '경영지원팀', email: 'hong@hecto.co.kr', is_active: true, status: 'active' },
    { emp_no: '20200002', name: '대표이사', dept: '경영지원팀', email: 'ceo@hecto.co.kr', is_active: true, status: 'active' },
    { emp_no: '20200003', name: '퇴사자', dept: '경영지원팀', email: 'out@hecto.co.kr', is_active: false, status: 'resigned' },
    { emp_no: '20200004', name: '휴직자', dept: '경영지원팀', email: 'rest@hecto.co.kr', is_active: false, status: 'leave' },
  ];

  // 대표이사(20200002) 제외
  const filtered = filterCalendarMembers(employees, ['20200002']);

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].empNo, '20200001');
  assert.equal(filtered[0].name, '홍길동');
});

test('buildNaverCalendarMembersPayload는 유효한 이메일만 중복 없이 USER 권한 목록으로 변환한다', () => {
  const members = [
    { empNo: '1', email: 'A@hecto.co.kr' },
    { empNo: '2', email: 'a@hecto.co.kr' }, // 소문자 중복
    { empNo: '3', email: 'invalid-email' },
    { empNo: '4', email: '' },
    { empNo: '5', email: 'b@hecto.co.kr' },
  ];

  const payload = buildNaverCalendarMembersPayload(members);
  assert.deepEqual(payload, [
    { id: 'a@hecto.co.kr', type: 'USER', role: 'EVENT_READ' },
    { id: 'b@hecto.co.kr', type: 'USER', role: 'EVENT_READ' },
  ]);
});

test('validateCalendarConfigPayload는 부서명 누락 시 에러를 던지고 사번 중복을 제거한다', () => {
  assert.throws(() => validateCalendarConfigPayload({ dept: '' }), /부서명을 입력해주세요/);

  const validated = validateCalendarConfigPayload({
    dept: ' 경영지원팀 ',
    excludedEmpNos: [' 20200002 ', '20200002', ''],
  });

  assert.deepEqual(validated, {
    dept: '경영지원팀',
    excludedEmpNos: ['20200002'],
    isActive: true,
  });
});

test('formatCalendarDate는 8자리 YYYYMMDD를 YYYY-MM-DD로 포맷팅한다', () => {
  assert.equal(formatCalendarDate('20261019'), '2026-10-19');
  assert.equal(formatCalendarDate('2026-10-19'), '2026-10-19');
  assert.equal(formatCalendarDate(''), '');
});

test('getNextCalendarDay는 월말 및 연말 경계를 타임존 왜곡 없이 하루 뒤 날짜로 계산한다', () => {
  assert.equal(getNextCalendarDay('2026-09-17'), '2026-09-18');
  assert.equal(getNextCalendarDay('2026-09-30'), '2026-10-01');
  assert.equal(getNextCalendarDay('2026-12-31'), '2027-01-01');
  assert.equal(getNextCalendarDay('2026-02-28'), '2026-03-01');
});

test('getLeaveLabel은 휴가 코드 또는 이름에 따른 적절한 한글 라벨을 반환한다', () => {
  assert.equal(getLeaveLabel({ leave_code: '12', leave_name: '12' }), '연차');
  assert.equal(getLeaveLabel({ leave_code: '16', leave_name: '4시간휴가 [오전]' }), '4시간휴가 [오전]');
  assert.equal(getLeaveLabel({ leave_code: '99', leave_name: '특별휴가' }), '특별휴가');
});

test('buildLeaveEventPayload는 RFC 5545 종일 일정 규격에 맞춰 end.date를 exclusive(종료일+1일)로 설정한다', () => {
  const payload = buildLeaveEventPayload({
    empNo: '2024001',
    empName: '김부호',
    dept: '경영지원팀',
    leave: {
      start_date: '20260914',
      end_date: '20260917',
      leave_code: '12',
      leave_name: '연차',
      leave_days: 4,
    },
  });

  // 4일간(14일~17일) 연차인 경우 end.date는 18일(자정)이어야 네이버웍스 UI에서 17일까지 표시됨
  assert.equal(payload.leaveKey, '2024001_2026-09-14_12');
  assert.equal(payload.eventComponents[0].summary, '김부호 · 연차');
  assert.equal(payload.eventComponents[0].start.date, '2026-09-14');
  assert.equal(payload.eventComponents[0].end.date, '2026-09-18');
  assert.match(payload.eventComponents[0].description, /기간: 2026-09-14 ~ 2026-09-17/);

  const parsedKey = parseLeaveKeyFromDescription(payload.eventComponents[0].description);
  assert.equal(parsedKey, '2024001_2026-09-14_12');
});
