import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDb, sourceLoader } from './helpers/loadSource.mjs';

test('employee schedule and overtime reads remain inside the requested scope', async () => {
  const db = memoryDb({
    sa_employee_schedules: [{ emp_no: '001', schedule_time: '09:00' }, { emp_no: '002', schedule_time: '10:00' }],
    sa_employee_overtime_rounds: [{ emp_no: '001' }, { emp_no: '002' }],
  });
  const api = sourceLoader({ './supabaseClient': { getAdminClient: () => db } })('src/lib/supabaseDb.js');
  for (const fn of [api.fetchEmployeeSchedules, api.fetchEmployeeOvertimeRounds]) {
    assert.deepEqual((await fn(['001'])).map(row => row.emp_no), ['001']);
    assert.deepEqual(await fn([]), []);
  }
});

test('attendance starts independent queries together and forwards authorized scope', async () => {
  let release;
  const hold = new Promise(resolve => { release = resolve; });
  const calls = [];
  const api = {
    getSettings: () => ({}),
    fetchAttendanceLogs: async () => { calls.push('logs'); await hold; return { logs: [], employees: [] }; },
    fetchEmployeeSchedules: async scope => { calls.push(['schedules', scope]); return []; },
    fetchOvertimeSettings: async () => { calls.push('settings'); return {}; },
    fetchEmployeeOvertimeRounds: async scope => { calls.push(['rounds', scope]); return []; },
  };
  const route = sourceLoader({
    '@/lib/auth': { verifySession: async () => ({ empNo: '001', isAdmin: false }) },
    '@/lib/supabaseClient': { getAdminClient: () => memoryDb({}) },
    '@/lib/supabaseDb': api,
  })('src/app/api/attendance/route.js');
  const pending = route.GET(new Request('http://localhost/api/attendance?month=2026-09'));
  await new Promise(resolve => setImmediate(resolve));
  try { assert.deepEqual(calls, ['logs', ['schedules', ['001']], 'settings', ['rounds', ['001']]]); }
  finally { release(); await pending; }
});
