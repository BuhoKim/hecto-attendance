import test from 'node:test';
import assert from 'node:assert/strict';
import { foldICSLine, buildICS } from '../src/lib/ical.js';

test('Korean and emoji lines fold within 75 UTF-8 bytes without changing content', () => {
  for (const text of [
    'DESCRIPTION:' + '경영지원실 휴가 일정 👨‍💻 '.repeat(12),
    'SUMMARY:' + '가'.repeat(22),
    'UID:' + 'a'.repeat(200),
  ]) {
    const folded = foldICSLine(text);
    for (const line of folded.split('\r\n')) {
      assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
      assert.equal(Buffer.from(line).toString('utf8'), line);
    }
    assert.equal(folded.replace(/\r\n /g, ''), text);
  }
});

test('calendar serialization keeps stable UID and dates while folding Korean descriptions', () => {
  const event = {
    uid: 'leave-20260001-20260918-20260918-1@hecto-qnm',
    startDate: '20260918', endDate: '2026-09-19',
    summary: '테스트 · 연차', description: '부서: 경영지원실\n' + '휴가 설명 '.repeat(30),
  };
  const ics = buildICS({calendarName:'경영지원실 휴가일정', events:[event]});
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(unfolded.includes('UID:' + event.uid));
  assert.ok(unfolded.includes('DTSTART;VALUE=DATE:20260918'));
  assert.ok(unfolded.includes('DTEND;VALUE=DATE:20260919'));
  assert.ok(ics.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
});
