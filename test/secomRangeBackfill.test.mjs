import test from 'node:test';
import assert from 'node:assert/strict';
import backfill from '../sync/backfill-secom-range.js';

test('range includes the final date and handles month boundaries', () => {
  assert.deepEqual(backfill.parseArgs(['2026-11-09', '2026-11-18', '--apply']),
    { from: '20261109', to: '20261119', last: '20261118', apply: true });
  assert.equal(backfill.parseArgs(['2026-12-31', '2026-12-31']).to, '20270101');
});

test('preview is the default; invalid and excessive ranges are rejected', () => {
  assert.equal(backfill.parseArgs(['2026-11-09', '2026-11-18']).apply, false);
  for (const args of [[], ['2026-02-30', '2026-03-01'], ['2026-11-18', '2026-11-09'],
    ['2026-11-01', '2026-12-03'], ['2026-11-01', '2026-11-02', '--apply', '--apply']]) {
    assert.throws(() => backfill.parseArgs(args));
  }
});

