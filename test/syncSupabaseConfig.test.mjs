import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const companyUrl = 'https://qcpqcuzvirmbjzqjzapt.supabase.co';
const oldUrl = 'https://gbfoempwoeurhhlxqxgy.supabase.co';
const secretKey = 'sb_secret_test_only_not_a_real_key';
const jwt = (claims) => `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test_signature`;
const config = (env) => require('../sync/supabaseClient').getCompanySupabaseConfig(env);

test('company worker uses the explicit company URL and server secret without mutating its environment', () => {
  const env = Object.freeze({ SUPABASE_URL: `${companyUrl}/`, SUPABASE_SERVICE_ROLE_KEY: secretKey, MYSQL_HOST: 'keep-mysql' });
  assert.deepEqual(config(env), { url: companyUrl, key: secretKey });
  assert.equal(env.MYSQL_HOST, 'keep-mysql');
});

test('legacy company service-role JWT is accepted', () => {
  const key = jwt({ ref: 'qcpqcuzvirmbjzqjzapt', role: 'service_role' });
  assert.deepEqual(config({ SUPABASE_URL: companyUrl, SUPABASE_SERVICE_ROLE_KEY: key }), { url: companyUrl, key });
});

test('old or unexpected destinations fail closed before a client can write', () => {
  for (const url of [oldUrl, 'https://ktdameqhgnlpfznfjgxi.supabase.co', `${companyUrl}/rest/v1`, `${companyUrl}?key=private`, '']) {
    assert.throws(() => config({ SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: secretKey }), /SUPABASE_URL.*qcpqcuzvirmbjzqjzapt/);
  }
});

test('old project JWT is rejected even when paired with the company URL', () => {
  const key = jwt({ ref: 'gbfoempwoeurhhlxqxgy', role: 'service_role' });
  assert.throws(() => config({ SUPABASE_URL: companyUrl, SUPABASE_SERVICE_ROLE_KEY: key }), /서비스 키.*회사/);
});

test('anonymous, publishable, missing and malformed keys are rejected without logging their values', () => {
  for (const key of ['', undefined, 'sb_publishable_test_only', 'secret-value-must-not-leak', 'sb_secret_', 'sb_secret_bad\nheader', 'eyJ.invalid.sensitive', jwt({ ref: 'qcpqcuzvirmbjzqjzapt', role: 'anon' })]) {
    assert.throws(() => config({ SUPABASE_URL: companyUrl, SUPABASE_SERVICE_ROLE_KEY: key }), (error) => {
      assert.match(error.message, /SUPABASE_SERVICE_ROLE_KEY|서비스 키/);
      if (key) assert.equal(error.message.includes(key), false);
      return true;
    });
  }
});

function runScript(name, url = oldUrl) {
  return spawnSync(process.execPath, [fileURLToPath(new URL(`../sync/${name}`, import.meta.url))], {
    encoding: 'utf8', timeout: 10000,
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: secretKey },
  });
}

test('read-only connection check exits unsuccessfully on a stale PM2 destination without revealing keys', () => {
  const result = runScript('check-supabase.js');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SUPABASE_URL.*qcpqcuzvirmbjzqjzapt/);
  assert.equal(result.stderr.includes(secretKey), false);
});

test('every attendance, employee and leave writer rejects the old project before starting', () => {
  for (const name of ['index.js', 'index3days.js', 'index15days.js', 'index30days.js', 'attendance.js', 'caps.js', 'employees.js', 'leaves.js', 'backfill-leaves.js', 'backfill-attendance-range.js', 'backfill-caps-attendance-range.js', 'backfill-caps-by-name.js']) {
    const result = runScript(name);
    assert.equal(result.status, 1, name);
    assert.match(result.stderr, /SUPABASE_URL.*qcpqcuzvirmbjzqjzapt/, name);
    assert.equal(result.stderr.includes(secretKey), false, name);
  }
});
