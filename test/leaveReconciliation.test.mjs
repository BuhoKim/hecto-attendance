import test from 'node:test';
import assert from 'node:assert/strict';
import reconciliation from '../src/lib/leaveReconciliation.cjs';

const leave = (patch = {}) => ({ emp_no: '1', emp_name: '직원', start_date: '20261022',
  end_date: '20261022', leave_code: '51', leave_name: '51', leave_days: 1, status: '40', ...patch });

function fixture({ source = [], existing = [], employees = [{ emp_no: '1', company_code: '1600' }], roster = [{ emp_no: '1' }] } = {}) {
  const writes = [], queries = [];
  let failSource = false, failPage = false, failUpsert = false;
  const conn = { async execute(sql, params) {
    queries.push({ sql, params });
    if (sql.includes('FROM hr_yuncha_use')) {
      if (failSource) throw new Error('source offline');
      if (params.length >= 3) {
        assert.match(sql, /D_END_DATE >= \? AND y.D_START_DATE <= \?/);
      }
      return [source];
    }
    return [roster];
  } };
  const rows = existing.map((row, index) => ({ id: String(index + 1), ...row }));
  const supabase = { from(table) {
    let filtered = table === 'sa_employees' ? employees : rows;
    let operation = 'select', payload, offset = 0;
    const q = {
      select() { return this; },
      eq(field, value) { filtered = filtered.filter((row) => row[field] === value); return this; },
      in(field, values) { filtered = filtered.filter((row) => values.includes(row[field])); return this; },
      gte(field, value) { filtered = filtered.filter((row) => row[field] >= value); return this; },
      lte(field, value) { filtered = filtered.filter((row) => row[field] <= value); return this; },
      order() { return this; },
      range(start, end) { offset = start; filtered = filtered.slice(start, end + 1); return this; },
      upsert(value) { operation = 'upsert'; payload = value; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          if (operation === 'select') return { data: filtered, error: failPage && table === 'sa_leaves' && offset >= 500 ? { message: 'page failed' } : null };
          writes.push({ table, operation, payload });
          if (operation === 'upsert') {
            if (failUpsert) return { error: { message: 'write failed' } };
            for (const row of payload) {
              const old = rows.find((item) => ['emp_no', 'start_date', 'leave_code'].every((field) => item[field] === row[field]));
              if (old) Object.assign(old, row);
              else rows.push({ id: String(rows.length + 1), ...row });
            }
          } else for (const row of filtered) Object.assign(row, payload);
          return { error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  } };
  return { source, rows, writes, queries, sync: (options = {}) => reconciliation.reconcileHrLeaves({ conn, supabase, companyCode: '1600', now: new Date('2026-10-23T00:00:00Z'), ...options }),
    failSource: () => { failSource = true; }, failPage: () => { failPage = true; }, failUpsert: () => { failUpsert = true; } };
}

test('yesterday: cancelled annual leave is excluded while replacement half-day stays approved; repeat is unchanged', async () => {
  const f = fixture({ source: [leave({ leave_code: '17', leave_name: '17', leave_days: 0.5 })],
    existing: [leave(), leave({ leave_code: '17', leave_name: '17', leave_days: 0.5 })] });
  assert.equal((await f.sync()).revoked, 1);
  assert.equal(f.rows[0].status, 'CANCELLED');
  assert.equal(f.rows[1].status, '40');
  f.writes.length = 0;
  const repeat = await f.sync();
  assert.equal(repeat.revoked, 0);
  assert.equal(repeat.changed, 0);
  assert.equal(repeat.cancelled.length, 1, 'external cancellation cleanup remains retryable');
  assert.equal(f.writes.length, 0);
});

test('date/code/end/day-count changes reconcile inside the window; cancelled records can be reapproved', async () => {
  const f = fixture({ source: [leave({ start_date: '20261024', end_date: '20261026', leave_days: 3 })],
    existing: [leave(), leave({ start_date: '20261024', end_date: '20261025', status: 'CANCELLED' })] });
  const result = await f.sync();
  assert.equal(result.changed, 1);
  assert.equal(result.revoked, 1);
  assert.equal(f.rows[1].end_date, '20261026');
  assert.equal(f.rows[1].leave_days, 3);
  assert.equal(f.rows[1].status, '40');
});

test('a successful empty approved snapshot cancels remaining approvals and preserves other company and nonapproved rows', async () => {
  const f = fixture({ existing: [leave(), leave({ emp_no: '2' }), leave({ leave_code: '12', status: '20' })],
    employees: [{ emp_no: '1', company_code: '1600' }, { emp_no: '2', company_code: '9999' }] });
  assert.equal((await f.sync()).revoked, 1);
  assert.deepEqual(f.rows.map((row) => row.status), ['CANCELLED', '40', '20']);
});

test('all target pages are read before writes, including beyond 500 rows', async () => {
  const f = fixture({ existing: Array.from({ length: 501 }, (_, i) => leave({ leave_code: String(i) })) });
  assert.equal((await f.sync()).revoked, 501);
  assert.ok(f.rows.every((row) => row.status === 'CANCELLED'));
});

test('source failure, empty roster, partial target read and invalid source never change target data', async () => {
  for (const type of ['source', 'roster', 'page', 'invalid', 'conflicting']) {
    const f = fixture({ roster: type === 'roster' ? [] : [{ emp_no: '1' }],
      source: type === 'invalid' ? [leave({ start_date: 'bad' })] : type === 'conflicting' ? [leave(), leave({ end_date: '20261023' })] : [],
      existing: Array.from({ length: 501 }, (_, i) => leave({ leave_code: String(i) })) });
    if (type === 'source') f.failSource();
    if (type === 'page') f.failPage();
    await assert.rejects(f.sync());
    assert.equal(f.writes.length, 0, type);
    assert.ok(f.rows.every((row) => row.status === '40'));
  }
});

test('failed approved upsert prevents cancellation writes', async () => {
  const f = fixture({ source: [leave({ leave_code: '17' })], existing: [leave()] });
  f.failUpsert();
  await assert.rejects(f.sync(), /write failed/);
  assert.equal(f.rows[0].status, '40');
  assert.equal(f.writes.filter((write) => write.operation === 'update').length, 0);
});

test('shortening the period updates the same approved row without treating it as a cancelled request', async () => {
  const f = fixture({ source: [leave({ start_date: '20261020', end_date: '20261022' })],
    existing: [leave({ start_date: '20261020', end_date: '20261025' })] });
  const result = await f.sync();
  assert.equal(result.changed, 1);
  assert.equal(result.revoked, 0);
  assert.equal(result.approved[0].end_date, '20261022');
  assert.equal(f.rows[0].end_date, '20261022');
  assert.equal(f.rows[0].status, '40');
});

test('individual employee backfill reconciles only that employee and accepts duplicate identical approvals', async () => {
  const f = fixture({ source: [leave(), leave()], existing: [leave(), leave({ emp_no: '2' })],
    employees: [{ emp_no: '1', company_code: '1600' }, { emp_no: '2', company_code: '1600' }] });
  assert.equal((await f.sync({ empNo: '1' })).total, 1);
  assert.equal(f.rows[1].status, '40');
  assert.ok(f.queries.every((query) => query.params.at(-1) === '1'));
});

test('comparison window follows KST midnight and handles month/year/leap boundaries', () => {
  for (const [now, from, to] of [
    ['2026-10-22T14:59:59Z', '20261021', '20261029'],
    ['2026-10-22T15:00:00Z', '20261022', '20261030'],
    ['2026-12-31T15:00:00Z', '20261231', '20270108'],
    ['2028-02-29T15:00:00Z', '20280229', '20280308'],
  ]) assert.deepEqual(reconciliation.getLeaveReconciliationWindow(new Date(now)), { from, to });
});

test('both boundaries and spanning leaves are included; older/later rows are preserved', async () => {
  const f = fixture({ existing: [
    leave({ start_date: '20261021', end_date: '20261021' }),
    leave(),
    leave({ start_date: '20261030', end_date: '20261030' }),
    leave({ start_date: '20261031', end_date: '20261031' }),
    leave({ start_date: '20261001', end_date: '20261101' }),
  ] });
  assert.equal((await f.sync()).revoked, 3);
  assert.deepEqual(f.rows.map((row) => row.status), ['40', 'CANCELLED', 'CANCELLED', '40', 'CANCELLED']);
  assert.deepEqual(f.queries[1].params, ['1600', '20261022', '20261030']);
});

test('approved spanning leave retains its full period across the window', async () => {
  const row = leave({ start_date: '20261001', end_date: '20261101' });
  const f = fixture({ source: [row], existing: [row] });
  const result = await f.sync();
  assert.equal(result.changed, 0);
  assert.equal(result.revoked, 0);
  assert.equal(result.approved[0].start_date, '20261001');
  assert.equal(result.approved[0].end_date, '20261101');
});

test('explicit historical employee backfill can still reconcile old history', async () => {
  const f = fixture({ source: [leave({ start_date: '20200101', end_date: '20200101' })] });
  const result = await f.sync({ empNo: '1', fullHistory: true });
  assert.equal(result.window, null);
  assert.equal(result.total, 1);
  assert.doesNotMatch(f.queries[1].sql, /D_END_DATE >=/);
});
