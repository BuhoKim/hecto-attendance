import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import daemon from '../sync/naverWorks.js';

const source = await readFile(new URL('../src/lib/naverWorks.js', import.meta.url), 'utf8');
const web = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

for (const [name, { calculateLeaveTimeWindow: window }] of [['web', web], ['daemon', daemon]]) {
  test(`${name}: full-day leave covers midnight through next midnight in every department`, () => {
    for (const dept of ['QA 1팀', '사업관리 1팀']) {
      for (const leave_code of ['12', '18', '51', '60']) {
        const result = window({ start_date: '20261230', end_date: '20261231', leave_code, dept });
        assert.equal(result.startTime, '2026-12-30T00:00:00+09:00');
        assert.equal(result.endTime, '2027-01-01T00:00:00+09:00');
      }
    }
    assert.equal(window({ start_date: '2028-02-29', end_date: '2028-02-29', leave_code: '12' }).endTime, '2028-03-01T00:00:00+09:00');
  });

  test(`${name}: half-day and two-hour leave keep their department-specific hours`, () => {
    for (const [dept, code, start, end] of [
      ['QA 1팀', '16', '08:00', '12:00'],
      ['QA 1팀', '17', '13:00', '17:00'],
      ['사업관리 1팀', '61', '10:00', '15:00'],
      ['사업관리 2팀', '62', '15:00', '19:00'],
      ['사업관리 1팀', '21', '09:00', '11:00'],
    ]) {
      const result = window({ start_date: '20261023', end_date: '20261023', leave_code: code, dept });
      assert.equal(result.startTime, `2026-10-23T${start}:00+09:00`);
      assert.equal(result.endTime, `2026-10-23T${end}:00+09:00`);
    }
  });
}
