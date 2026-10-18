import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLoader, memoryDb } from './helpers/loadSource.mjs';

const user = { id: 'user-1', email: 'person@example.test', user_metadata: {} };
function fixture(active = true) {
  return memoryDb({ sa_profiles: [{ id: user.id, emp_no: '001', is_admin: false }], sa_employees: [{ emp_no: '001', is_active: active, email: user.email, login_id: 'person' }] });
}
const req = () => new Request('http://localhost/api/auth/me', { headers: { cookie: 'sb-access-token=expired; sb-refresh-token=refresh-1' } });

test('expired access token renews both cookies and preserves authenticated identity', async () => {
  const db = fixture();
  const writes = new Map();
  db.auth = {
    getUser: async () => ({ data: { user: null }, error: { status: 401 } }),
    refreshSession: async ({ refresh_token }) => {
      assert.equal(refresh_token, 'refresh-1');
      return { data: { user, session: { access_token: 'new-access', refresh_token: 'new-refresh', user } }, error: null };
    },
  };
  const { verifySession } = sourceLoader({
    './supabaseClient': { getAdminClient: () => db },
    'next/headers': { cookies: async () => ({ get() {}, set: (name, value, options) => writes.set(name, { value, options }) }) },
  })('src/lib/auth.js');
  const session = await verifySession(req());
  assert.equal(session?.userId, user.id);
  assert.equal(writes.get('sb-access-token')?.value, 'new-access');
  assert.equal(writes.get('sb-refresh-token')?.value, 'new-refresh');
  assert.equal(writes.get('sb-refresh-token')?.options.httpOnly, true);
});

test('simultaneous expired requests share refresh rotation', async () => {
  const db = fixture();
  let rotations = 0;
  db.auth = {
    getUser: async () => ({ data: { user: null }, error: { status: 401 } }),
    refreshSession: async () => {
      rotations++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { data: { user, session: { access_token: 'new-access', refresh_token: 'new-refresh', user } } };
    },
  };
  const { verifySession } = sourceLoader({ './supabaseClient': { getAdminClient: () => db }, 'next/headers': { cookies: async () => ({ get() {}, set() {} }) } })('src/lib/auth.js');
  const sessions = await Promise.all([verifySession(req()), verifySession(req()), verifySession(req())]);
  assert.ok(sessions.every(session => session?.userId === user.id));
  assert.equal(rotations, 1);
});

test('refresh never restores an inactive employee session', async () => {
  const db = fixture(false);
  db.auth = { getUser: async () => ({ data: { user: null }, error: { status: 401 } }), refreshSession: async () => ({ data: { user, session: { access_token: 'new', refresh_token: 'new-r', user } } }) };
  const { verifySession } = sourceLoader({ './supabaseClient': { getAdminClient: () => db }, 'next/headers': { cookies: async () => ({ get() {}, set() {} }) } })('src/lib/auth.js');
  assert.equal(await verifySession(req()), null);
});

test('inactive employee cannot receive fresh login cookies', async () => {
  const db = fixture(false);
  db.auth = { signInWithPassword: async () => ({ data: { user, session: { access_token: 'access', refresh_token: 'refresh' } } }) };
  const route = sourceLoader({
    '@/lib/supabaseClient': { getAdminClient: () => db },
    '@/lib/authMode': { MASTER_LOGIN_EMAIL: 'master@example.test', AUTH_MODE_COOKIE: 'sa-auth-mode', createAuthModeCookie: () => 'signed' },
  })('src/app/api/auth/login/route.js');
  const response = await route.POST(new Request('http://localhost/api/auth/login', { method: 'POST', body: JSON.stringify({ identifier: 'person', password: 'a-password' }) }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('account creation and password change honor the common session rejection', async () => {
  for (const path of ['src/app/api/admin/create-user/route.js', 'src/app/api/auth/change-password/route.js']) {
    const db = fixture(false);
    db.auth = { getUser: async () => ({ data: { user } }) };
    const route = sourceLoader({ '@/lib/auth': { verifySession: async () => null }, '@/lib/supabaseClient': { getAdminClient: () => db } })(path);
    const request = new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify({ newPassword: 'a-password' }) });
    request.cookies = { get: () => ({ value: 'valid' }) };
    assert.equal((await route.POST(request)).status, 401);
  }
});
