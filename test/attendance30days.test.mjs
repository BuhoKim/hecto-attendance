import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function loadWorker() {
  const writes = [];
  const module = { exports: {} };
  const sandbox = {
    module,
    process: { env: {} },
    console: { log() {} },
    require(name) {
      if (name === './loadEnv') return { loadSyncEnv() {} };
      if (name === 'mysql2/promise') return {};
      if (name === './supabaseClient') return {
        createSyncSupabaseClient: () => ({
          from(table) {
            assert.equal(table, 'sa_attendance', 'must not update checkpoints');
            return { async upsert(rows, options) { writes.push({ rows, options }); return { error: null }; } };
          },
        }),
      };
      throw new Error('Unexpected dependency: ' + name);
    },
  };
  vm.runInNewContext(readFileSync(new URL('../sync/index30days.js', import.meta.url), 'utf8'), sandbox);
  return { ...module.exports, writes };
}

test('30-day window uses KST across month/year boundaries regardless of host timezone', () => {
  const worker = loadWorker();
  for (const [now, from, to] of [
    ['2026-09-18T00:00:00Z', '20260819090000', '20260918090000'],
    ['2026-01-10T23:30:45Z', '20251212083045', '20260111083045'],
  ]) {
    const window = worker.getThirtyDayWindow(new Date(now));
    assert.equal(window.from, from);
    assert.equal(window.to, to);
  }
});

test('both sources use the same bounded window and upsert without moving checkpoints', async () => {
  const worker = loadWorker();
  const window = worker.getThirtyDayWindow(new Date('2026-09-18T00:00:00Z'));
  const queries = [];
  const conn = {
    async execute(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('t_secom_alarm')) return [[{
        emp_no: '20260001', sabun: '160020260001', a_time: '20260918080000', eq_code: '4000', flag1: '1',
      }]];
      return [[{
        emp_no: '20260001', idno: '160020260001', e_date: '20260918', e_time: '08:00:00', gate_code: '4000',
      }]];
    },
  };
  assert.equal(await worker.syncSecomAttendance(conn, window), 1);
  assert.equal(await worker.syncCapsAttendance(conn, window), 1);
  assert.deepEqual(Array.from(queries[0].params), ['1600', '1600', window.from, window.to]);
  assert.deepEqual(Array.from(queries[1].params), ['1600', '1600', '08', '20260819', '20260819', '090000', '20260918', '20260918', '090000']);
  assert.match(queries[0].sql, /t\.ATime >= \? AND t\.ATime <= \?/);
  assert.match(queries[1].sql, /t\.E_DATE < \?/);
  assert.deepEqual(worker.writes.map(write => write.rows[0].source), ['secom', 'caps']);
  for (const write of worker.writes) {
    assert.equal(write.options.onConflict, 'sabun,a_time');
    assert.equal(write.rows[0].emp_no, '20260001');
    assert.equal(write.rows[0].log_time, '2026-09-18T08:00:00+09:00');
  }
});
