import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader, memoryDb } from './helpers/loadSource.mjs';

const load = sourceLoader();
const { isAdminRole } = load('src/lib/roleUtils.js');
test('editable rank and job title never grant administrative privileges', () => {
  for (const rank of ['admin', '관리자', 'root']) {
    assert.equal(isAdminRole({ rank, position: '시스템 관리자', is_admin: false }), false);
  }
  assert.equal(isAdminRole({ is_admin: true }), true);
  assert.equal(isAdminRole({ is_admin: 'false' }), false);
});

const employeeSession = { userId: 'user-1', empNo: '001', isAdmin: false, dept: 'A팀', team: 'A팀', position: '팀장' };
function request(body, url = 'http://localhost/api/example') {
  return new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'sb-access-token=valid' }, body: JSON.stringify(body) });
}

test('self-service profile cannot change the authorization department', async () => {
  const tables = { sa_profiles: [{ id: 'user-1', emp_no: '001', is_admin: false }], sa_employees: [{ emp_no: '001', dept: 'A팀' }] };
  const db = memoryDb(tables);
  db.auth = { getUser: async () => ({ data: { user: { id: 'user-1' } } }) };
  const route = sourceLoader({ '@/lib/supabaseClient': { getAdminClient: () => db }, '@/lib/auth': { verifySession: async () => employeeSession } })('src/app/api/auth/profile/route.js');
  const response = await route.PATCH(request({ dept: 'B팀', rank: '선임' }));
  assert.equal(response.status, 403);
  assert.equal(tables.sa_employees[0].dept, 'A팀');
});

test('self-service rank update preserves server-owned role and identity', async () => {
  const tables = { sa_profiles: [{ id: 'user-1', emp_no: '001', is_admin: false, position: '팀장' }] };
  const db = memoryDb(tables);
  db.auth = { getUser: async () => ({ data: { user: { id: 'user-1' } } }) };
  const route = sourceLoader({ '@/lib/supabaseClient': { getAdminClient: () => db }, '@/lib/auth': { verifySession: async () => employeeSession } })('src/app/api/auth/profile/route.js');
  const response = await route.PATCH(request({ rank: 'admin', is_admin: true, emp_no: '999' }));
  assert.equal(response.status, 200);
  assert.equal(tables.sa_profiles[0].emp_no, '001');
  assert.equal(isAdminRole(tables.sa_profiles[0]), false);
});

test('blank parsed attendance scope is rejected before any data retrieval', async () => {
  const route = sourceLoader({
    '@/lib/auth': { verifySession: async () => ({ ...employeeSession, position: '', isLeader: false }) },
    '@/lib/supabaseClient': { getAdminClient: () => memoryDb({}) },
    '@/lib/supabaseDb': { getSettings: () => ({}), fetchAttendanceLogs: () => { throw new Error('Unrestricted retrieval reached'); } },
  })('src/app/api/attendance/route.js');
  for (const filter of [',', ' ', '', ', ,']) {
    const response = await route.GET(new Request(`http://localhost/api/attendance?month=2026-09&empNo=${encodeURIComponent(filter)}`));
    assert.equal(response.status, 400);
  }
});

test('team leader cannot spoof target department when changing overtime', async () => {
  let written = false;
  const route = sourceLoader({
    '@/lib/auth': { verifySession: async () => employeeSession },
    '@/lib/supabaseClient': { getAdminClient: () => memoryDb({ sa_employees: [{ emp_no: '002', dept: 'B팀', is_active: true }] }) },
    '@/lib/supabaseDb': { saveEmployeeOvertimeRound: async () => { written = true; } },
  })('src/app/api/attendance/overtime-rounds/route.js');
  const response = await route.POST(request({ empNo: '002', employeeDept: 'A팀', roundName: '1차', startDate: '2026-09-01', endDate: '2026-09-30' }));
  assert.equal(response.status, 403);
  assert.equal(written, false);
});

test('inactive employees and administrators cannot retain a session', async () => {
  for (const is_admin of [false, true]) {
    const db = memoryDb({ sa_profiles: [{ id: 'user-1', emp_no: '001', is_admin }], sa_employees: [{ emp_no: '001', is_active: false, dept: 'A팀' }] });
    db.auth = { getUser: async () => ({ data: { user: { id: 'user-1', email: 'person@example.test' } } }) };
    const { verifySession } = sourceLoader({ './supabaseClient': { getAdminClient: () => db }, 'next/headers': { cookies: async () => ({ get() {} }) } })('src/lib/auth.js');
    assert.equal(await verifySession(request({})), null);
  }
});
