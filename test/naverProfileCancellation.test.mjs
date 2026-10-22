import test from 'node:test';
import assert from 'node:assert/strict';
import cancellation from '../src/lib/naverProfileCancellation.cjs';
import daemon from '../sync/naverWorks.js';

const leave = (patch = {}) => ({ email: 'employee@example.com', start_date: '20261023', end_date: '20261023', leave_code: '12', status: 'CANCELLED', ...patch });
const window = daemon.calculateLeaveTimeWindow(leave());
const status = { ...window, userProfileStatusId: 'cancelled-status' };
const now = new Date('2026-10-23T00:00:00Z').getTime();

function sync(leaves, statuses, options = {}) {
  const writes = [];
  return { writes, run: () => cancellation.removeCancelledProfileStatuses({ leaves, calculateWindow: daemon.calculateLeaveTimeWindow,
    getAccessToken: async () => 'test', now, fetchImpl: async (url, request = {}) => {
      if (request.method === 'DELETE') { writes.push(url); return { ok: true }; }
      return { ok: !options.failRead, status: 503, json: async () => ({ userProfileStatuses: statuses }) };
    } }) };
}

test('cancelled leave clears current/reserved matching status while keeping unrelated statuses', async () => {
  const f = sync([leave()], [status, { ...status, userProfileStatusId: 'busy', profileStatusId: 'BUSY' },
    { ...status, userProfileStatusId: 'other-message', statusMessage: '외근' },
    { ...status, userProfileStatusId: 'other-day', startTime: '2026-10-24T00:00:00+09:00' }]);
  assert.equal(await f.run(), 1);
  assert.equal(f.writes.length, 1);
  assert.ok(f.writes[0].endsWith('/cancelled-status'));
});

test('equivalent approved leave protects an active status from cancellation of an older leave code', async () => {
  const f = sync([leave(), leave({ leave_code: '60', status: '40' })], [status]);
  assert.equal(await f.run(), 0);
  assert.deepEqual(f.writes, []);
});

test('replacement afternoon leave does not protect the cancelled full-day leave status', async () => {
  const f = sync([leave(), leave({ leave_code: '17', status: '40' })], [status]);
  assert.equal(await f.run(), 1);
});

test('failed status read never deletes anything; expired actual statuses are left alone', async () => {
  const f = sync([leave()], [status], { failRead: true });
  await assert.rejects(f.run(), /조회 실패/);
  assert.deepEqual(f.writes, []);
  const oldLeave = leave({ start_date: '20200101', end_date: '20200101' });
  const expired = sync([oldLeave], [{ ...daemon.calculateLeaveTimeWindow(oldLeave), userProfileStatusId: 'expired' }]);
  assert.equal(await expired.run(), 0);
});

test('a leave shortened to yesterday clears its previously longer active status', async () => {
  const old = leave({ start_date: '20261020', end_date: '20261025' });
  const current = leave({ start_date: '20261020', end_date: '20261022', status: '40' });
  // Even a retry with only the updated DB row must find the stale longer status.
  const f = sync([current], [{ ...daemon.calculateLeaveTimeWindow(old), userProfileStatusId: 'old-long-status' }]);
  assert.equal(await f.run(), 1);
  assert.ok(f.writes[0].endsWith('/old-long-status'));
});
