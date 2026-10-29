import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { monthWindow, logTime, buildRoster, prepareRecords, syncMonth } = require('../sync/backfill-attendance-2025.js');
const roster = buildRoster([{ emp_no: '20220032' }, { emp_no: '00000012' }]);
const jan = monthWindow(1);
const stamp = '2026-01-01T00:00:00.000Z';
const secom = (overrides = {}) => ({ sabun: '160020220032', a_time: '20250101000000',
  card_no: '123', eq_code: '4000', flag1: '1', ...overrides });
const caps = (overrides = {}) => ({ idno: '160000000012', e_date: '20250131', e_time: '23:59:59',
  card_no: '456', gate_code: '4004', e_group: '08', e_mode: '01', ...overrides });

test('all 2025 monthly windows include the final second and exclude 2026', () => {
  assert.deepEqual(monthWindow(1), { month: '2025-01', from: '20250101', to: '20250201' });
  assert.deepEqual(monthWindow(12), { month: '2025-12', from: '20251201', to: '20260101' });
  assert.equal(logTime('20251231235959'), '2025-12-31T23:59:59+09:00');
  assert.equal(logTime('20250230090000'), null);
});

test('maps both systems without excluding retired or HR-unmatched employee identifiers', () => {
  const result = prepareRecords([secom(), secom({ sabun: '160020190099', a_time: '20250101010000' })],
    [caps()], roster, jan, stamp);
  assert.equal(result.records.length, 3);
  assert.equal(result.unmatchedHr, 1);
  assert.equal(result.records[0].event_type, '출근');
  assert.equal(result.records[1].emp_no, '20190099');
  assert.equal(result.records[2].emp_no, '00000012');
  assert.equal(result.records[2].a_time, '20250131235959');
});

test('counts invalid or duplicate rows and refuses ambiguous same-second records', () => {
  const result = prepareRecords([
    secom(), secom(), secom({ eq_code: '1001' }),
    secom({ sabun: '1600BAD00000' }), secom({ a_time: '20250201000000' }),
  ], [caps()], roster, jan, stamp);
  assert.equal(result.ambiguous, 1);
  assert.equal(result.duplicate, 1);
  assert.equal(result.invalid, 2);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].source, 'caps');
});

function fakeDb(initial = []) {
  const records = new Map(initial.map((row) => [JSON.stringify([row.sabun, row.a_time]), { ...row }]));
  let writes = 0;
  return {
    records,
    get writes() { return writes; },
    from(table) {
      assert.equal(table, 'sa_attendance');
      return {
        upsert(rows, options) {
          assert.deepEqual(options, { onConflict: 'sabun,a_time', ignoreDuplicates: true });
          return { async select() {
            writes++;
            const inserted = [];
            for (const row of rows) {
              const k = JSON.stringify([row.sabun, row.a_time]);
              if (!records.has(k)) { records.set(k, { ...row }); inserted.push({ sabun: row.sabun, a_time: row.a_time }); }
            }
            return { data: inserted, error: null };
          } };
        },
        select() {
          const query = { like() { return query; }, gte() { return query; }, lt() { return query; },
            order() { return query; }, async range(from, to) { return { data: [...records.values()].slice(from, to + 1), error: null }; } };
          return query;
        },
      };
    },
  };
}

test('monthly import preserves existing rows and verifies the inserted records', async () => {
  const old = prepareRecords([secom()], [], roster, jan, stamp).records[0];
  old.card_no = 'old-card';
  const db = fakeDb([old]);
  const conn = { async execute(sql) {
    if (sql.includes('t_secom_alarm')) return [[secom()]];
    if (sql.includes('COUNT(*)')) return [[{ n: 0 }]];
    if (sql.includes('FROM tenter')) return [[caps()]];
    throw new Error('unexpected query');
  } };
  const result = await syncMonth(conn, db, roster, jan);
  assert.equal(result.inserted, 1);
  assert.equal(result.alreadyPresent, 1);
  assert.equal(result.checked, 2);
  assert.equal(result.different, 1);
  assert.equal(db.records.get(JSON.stringify([old.sabun, old.a_time])).card_no, 'old-card');
});

test('a failed source read causes no writes for that month', async () => {
  const db = fakeDb();
  const conn = { async execute(sql) {
    if (sql.includes('t_secom_alarm')) return [[secom()]];
    throw new Error('source unavailable');
  } };
  await assert.rejects(syncMonth(conn, db, roster, jan), /source unavailable/);
  assert.equal(db.writes, 0);
});
