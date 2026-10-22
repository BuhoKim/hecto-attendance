import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCalendarLeaveSources } from '../src/lib/naverCalendarSync.mjs';

function fixture() {
  const employees = [
    { emp_no: '1', name: '실원', dept: '경영지원실', is_active: true },
    { emp_no: '2', name: '팀원', dept: '경영지원팀', is_active: true },
  ];
  const leaves = employees.map((emp) => ({ emp_no: emp.emp_no, start_date: '20261020', end_date: '20261021', status: '40', leave_code: '12' }));
  const events = new Map([['manual', { eventId: 'manual', summary: '수동 일정', description: '', start: { date: '2026-10-20' } }]]);
  const writes = [];
  const readFromDates = [];
  let failRead = false;
  let nextId = 0;
  const supabase = { from(table) {
    let rows = table === 'sa_employees' ? employees : leaves;
    const query = {
      select() { return this; },
      in(key, values) { rows = rows.filter((row) => values.includes(row[key])); return this; },
      eq(key, value) { rows = rows.filter((row) => row[key] === value); return this; },
      gte() { return this; }, lte() { return this; }, order() { return this; },
      range(start, end) { rows = rows.slice(start, end + 1); return this; },
      then(resolve) { return Promise.resolve({ data: rows, error: null }).then(resolve); },
    };
    return query;
  } };
  const fetchImpl = async (url, options = {}) => {
    if (!options.method) {
      readFromDates.push(new URL(url).searchParams.get('fromDateTime'));
      return { ok: !failRead, status: failRead ? 503 : 200, json: async () => ({ events: [...events.values()].map((component) => ({ eventComponents: [component] })) }) };
    }
    writes.push(options.method);
    const id = decodeURIComponent(new URL(url).pathname.split('/').pop());
    if (options.method === 'DELETE') events.delete(id);
    else {
      const component = JSON.parse(options.body).eventComponents[0];
      const eventId = options.method === 'POST' ? `created-${++nextId}` : id;
      events.set(eventId, { ...component, eventId });
    }
    return { ok: true, status: 200 };
  };
  const sync = (sourceDepts, options = {}) => syncCalendarLeaveSources({ calendarId: 'calendar', dept: '경영지원실',
    sourceDepts, supabase, token: 'test', serviceAccount: 'test', fetchImpl, now: new Date('2026-10-19T02:00:00Z'), ...options });
  return { sync, events, writes, leaves, readFromDates, failReads: () => { failRead = true; } };
}

test('오래된 마지막 휴가가 취소돼도 해당 과거 구간을 조회하고 일정에서 제거한다', async () => {
  const f = fixture();
  f.leaves.splice(1);
  f.leaves[0].start_date = '20200101';
  f.leaves[0].end_date = '20200101';
  await f.sync(['경영지원실']);
  f.leaves[0].status = 'CANCELLED';
  f.readFromDates.length = 0;
  const result = await f.sync(['경영지원실']);
  assert.equal(result.totalLeaves, 0);
  assert.equal(result.deleted, 1);
  assert.equal(f.readFromDates[0], '2019-12-31T15:00:00.000Z');
  assert.deepEqual([...f.events.keys()], ['manual']);
});

test('선택 조직 추가·해제·재포함은 일정에 반영되고 반복 동기화는 중복 생성하지 않는다', async () => {
  const f = fixture();
  assert.equal((await f.sync(['경영지원실'])).created, 1);
  assert.equal((await f.sync(['경영지원실', '경영지원팀'])).created, 1);
  assert.equal((await f.sync(['경영지원실', '경영지원팀'])).created, 0);
  const removed = await f.sync(['경영지원실']);
  assert.equal(removed.deleted, 1);
  assert.equal((await f.sync(['경영지원실', '경영지원팀'])).created, 1);
  assert.equal(f.events.size, 3);
  assert.ok(f.events.has('manual'));
});

test('모든 직원 제외 시에도 관리 일정을 지우고 수동 일정은 보존한다', async () => {
  const f = fixture();
  await f.sync(['경영지원실', '경영지원팀']);
  assert.equal((await f.sync(['경영지원실', '경영지원팀'], { excludedEmpNos: ['1', '2'] })).deleted, 2);
  assert.deepEqual([...f.events.keys()], ['manual']);
});

test('기존 일정 조회 실패 시 일정 생성과 삭제를 모두 중단한다', async () => {
  const f = fixture();
  f.failReads();
  await assert.rejects(f.sync(['경영지원실']), /조회 실패/);
  assert.deepEqual(f.writes, []);
});

test('겸직자 명시 포함 및 휴가 기간 변경이 갱신되고 취소된 휴가는 제거된다', async () => {
  const f = fixture();
  const first = await f.sync(['경영지원실'], { additionalEmpNos: ['2'] });
  assert.equal(first.created, 2);
  f.leaves[1].end_date = '20261022';
  assert.equal((await f.sync(['경영지원실'], { additionalEmpNos: ['2'] })).updated, 1);
  f.leaves.splice(1, 1);
  assert.equal((await f.sync(['경영지원실'], { additionalEmpNos: ['2'] })).deleted, 1);
});
