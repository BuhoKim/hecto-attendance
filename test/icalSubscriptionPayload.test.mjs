import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIcalSubscriptionUpdatePayload } from '../src/lib/icalSubscriptionPayload.mjs';

test('iCal 구독 부서 수정 payload는 공백을 제거하고 중복 부서를 합친다', () => {
  assert.deepEqual(
    buildIcalSubscriptionUpdatePayload({ depts: ['  1팀 ', '2팀', '1팀', ''] }),
    { depts: ['1팀', '2팀'] },
  );
});

test('부서 수정 시 라벨을 보내지 않으면 기존 라벨을 유지할 수 있다', () => {
  assert.deepEqual(
    buildIcalSubscriptionUpdatePayload({ depts: ['3팀'] }),
    { depts: ['3팀'] },
  );
});
