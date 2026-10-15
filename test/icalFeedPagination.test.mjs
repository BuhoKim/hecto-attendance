import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { sourceLoader } from './helpers/loadSource.mjs';

const employees = [
  { emp_no: '001', name: '테스트직원', dept: 'A팀', is_active: true },
  { emp_no: '002', name: '다른직원', dept: 'B팀', is_active: true },
  { emp_no: '003', name: '퇴사직원', dept: 'A팀', is_active: false },
];

function leave(id, extra = {}) {
  return {
    id, emp_no: '001', emp_name: '테스트직원',
    start_date: '2026-10-05', end_date: '2026-10-05',
    leave_code: String(id), leave_name: '연차', leave_days: 1, status: '40',
    ...extra,
  };
}

// Keep the actual Supabase query builder and ICS serializer. Replace only HTTP.
function feedWithRows(rows, { failAtOffset } = {}) {
  const client = createClient('https://calendar-test.supabase.co', 'test-only-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      async fetch(input) {
        const url = new URL(input instanceof Request ? input.url : input);
        const table = url.pathname.split('/').at(-1);
        assert.ok(['sa_leaves', 'sa_employees', 'sa_profiles'].includes(table));
        if (table === 'sa_leaves' && url.searchParams.has('offset')) {
          assert.equal(url.searchParams.get('order'), 'id.asc', 'each page needs a unique, stable order');
        }
        if (table === 'sa_leaves' && Number(url.searchParams.get('offset')) === failAtOffset) {
          return Response.json({ message: 'test page failure', code: 'XX000' }, { status: 400 });
        }
        let data = [...(table === 'sa_leaves' ? rows : table === 'sa_employees' ? employees : [])];
        for (const [key, filter] of url.searchParams) {
          if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
          const dot = filter.indexOf('.');
          const operator = filter.slice(0, dot);
          const value = filter.slice(dot + 1);
          data = data.filter(row => {
            if (operator === 'eq') return String(row[key]) === value;
            if (operator === 'in') return value.slice(1, -1).split(',').includes(String(row[key]));
            if (operator === 'gte') return row[key] >= value;
            if (operator === 'lte') return row[key] <= value;
            assert.fail(`Unexpected filter: ${filter}`);
          });
        }
        const order = url.searchParams.get('order');
        if (order) {
          const keys = order.split(',').map(value => value.split('.'));
          data.sort((a, b) => {
            for (const [key, direction] of keys) {
              const comparison = a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0;
              if (comparison) return direction === 'desc' ? -comparison : comparison;
            }
            return 0;
          });
        }
        const offset = Number(url.searchParams.get('offset') || 0);
        const limit = Math.min(1000, Number(url.searchParams.get('limit') || 1000));
        const page = data.slice(offset, offset + limit);
        return Response.json(table === 'sa_employees' && url.searchParams.has('emp_no')
          ? page[0] || null : page);
      },
    },
  });
  return sourceLoader({ './supabaseClient': { getAdminClient: () => client } })('src/lib/icalFeed.js');
}

function eventUids(ics) {
  return [...ics.replace(/\r\n /g, '').matchAll(/^UID:(.+)$/gm)].map(match => match[1].trim());
}

for (const count of [0, 499, 500, 1000, 1174]) {
  test(`calendar includes every leave exactly once for ${count} rows`, async () => {
    const rows = Array.from({ length: count }, (_, i) => leave(i + 1)).reverse();
    const feed = feedWithRows(rows);
    const uids = eventUids(await feed.buildLeaveIcsForDepartments({ departments: ['A팀'] }));
    assert.equal(uids.length, count);
    assert.equal(new Set(uids).size, count);
    for (let id = 1; id <= count; id++) {
      assert.ok(uids.includes(`leave-001-2026-10-05-2026-10-05-${id}@hecto-qnm`));
    }
  });
}

test('all pages retain department, active employee, approval and overlapping-date filters', async () => {
  const rows = Array.from({ length: 1174 }, (_, i) => leave(i + 1));
  rows.push(
    leave(2001, { emp_no: '002' }),
    leave(2002, { emp_no: '003' }),
    leave(2003, { status: '10' }),
    leave(2004, { start_date: '2026-09-01', end_date: '2026-09-30' }),
    leave(2005, { start_date: '2026-11-01', end_date: '2026-11-01' }),
    leave(2006, { start_date: '2026-09-30', end_date: '2026-10-02' }),
  );
  const feed = feedWithRows(rows.reverse());
  const ics = await feed.buildLeaveIcsForDepartments({ departments: ['A팀'], from: '2026-10-01', to: '2026-10-31' });
  const uids = eventUids(ics);
  assert.equal(uids.length, 1175);
  assert.ok(uids.includes('leave-001-2026-09-30-2026-10-02-2006@hecto-qnm'));
  for (const id of [2001, 2002, 2003, 2004, 2005]) {
    assert.ok(!uids.some(uid => uid.endsWith(`-${id}@hecto-qnm`)));
  }
});

test('personal calendar continues to use its owner current department across pages', async () => {
  const rows = Array.from({ length: 1174 }, (_, i) => leave(i + 1, { emp_no: '002' }));
  rows.push(leave(2000));
  const feed = feedWithRows(rows);
  const uids = eventUids(await feed.buildLeaveIcsForDepartments({
    departments: ['A팀'], subscriptionOwnerEmpNo: '002',
  }));
  assert.equal(uids.length, 1174);
  assert.ok(uids.every(uid => uid.startsWith('leave-002-')));
});

test('later page failure rejects the feed instead of publishing a partial calendar', async () => {
  const feed = feedWithRows(Array.from({ length: 1174 }, (_, i) => leave(i + 1)), { failAtOffset: 500 });
  await assert.rejects(feed.buildLeaveIcsForDepartments({ departments: ['A팀'] }), /휴가 목록 조회 실패/);
});
