import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_REFRESH_DELAY_MS,
  MAX_REFRESH_DELAY_MS,
  getNextRefreshDelay,
} from '../src/lib/refreshSchedule.mjs';

test('uses five-minute refresh interval after successful refresh', () => {
  assert.equal(INITIAL_REFRESH_DELAY_MS, 300000);
  assert.equal(getNextRefreshDelay(true, INITIAL_REFRESH_DELAY_MS), 300000);
});

test('backs off failed refreshes up to ten minutes', () => {
  assert.equal(getNextRefreshDelay(false, INITIAL_REFRESH_DELAY_MS), 600000);
  assert.equal(getNextRefreshDelay(false, 600000), MAX_REFRESH_DELAY_MS);
});
