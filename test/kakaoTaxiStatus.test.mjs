import test from 'node:test';
import assert from 'node:assert/strict';
import { isExcludedTaxiOrderStatus, normalizeTaxiOrderStatus } from '../src/lib/kakaoTaxiStatus.js';

test('취소·환불 계열 상태는 정상 택시 이용 통계에서 제외한다', () => {
  for (const status of ['canceled', 'cancelled', 'refunded', 'void', 'failed', '취소', '환불']) {
    assert.equal(isExcludedTaxiOrderStatus(status), true, status);
  }
});

test('paid와 알 수 없는 빈 상태는 제외하지 않는다', () => {
  assert.equal(isExcludedTaxiOrderStatus('paid'), false);
  assert.equal(isExcludedTaxiOrderStatus(''), false);
  assert.equal(normalizeTaxiOrderStatus('  PAID '), 'paid');
});
