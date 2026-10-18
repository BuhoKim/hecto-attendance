import { createClient } from '@supabase/supabase-js';
import { loadEnvFile } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settings, sourceRef, targetRef, safeError } from './connection.mjs';

const directory = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z');
let stage = 'configuration';
let database;
try {
  const target = settings('TARGET');
  const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('TARGET_STORAGE_KEY_MISSING');
  const supabase = createClient(`https://${targetRef}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  stage = 'table-api';
  const results = [];
  for (const name of ['sa_employees', 'sa_attendance', 'sa_leaves', 'sa_profiles', 'sa_ical_subscriptions']) {
    const response = await supabase.from(name).select('*', { head: true, count: 'exact' });
    if (response.error) throw Object.assign(new Error('TABLE_API_FAILED'), { code: response.error.code });
    const expected = manifest.tables.find(t => t.schema === 'public' && t.name === name)?.rows;
    results.push({ table: name, count: response.count, match: String(response.count) === expected });
  }
  stage = 'auth-admin-api';
  const listUserIds = async client => {
    let page = 1;
    const ids = [];
    while (true) {
      const response = await client.auth.admin.listUsers({ page, perPage: 100 });
      if (response.error) throw new Error('AUTH_ADMIN_API_FAILED');
      ids.push(...response.data.users.map(user => user.id));
      if (response.data.users.length < 100) break;
      page += 1;
    }
    return ids.sort();
  };
  const userIds = await listUserIds(supabase);
  loadEnvFile('.env.local');
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${sourceRef}.supabase.co`) throw new Error('SOURCE_API_CONFIGURATION_MISSING');
  const sourceApi = createClient(`https://${sourceRef}.supabase.co`, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const sourceIds = await listUserIds(sourceApi);
  const users = userIds.length;
  const authIdsMatch = JSON.stringify(userIds) === JSON.stringify(sourceIds);
  stage = 'references';
  database = target.client();
  await database.connect();
  await database.query('BEGIN TRANSACTION READ ONLY');
  const references = (await database.query(`SELECT
    (SELECT count(*)::int FROM public.sa_profiles p LEFT JOIN auth.users u ON u.id=p.id WHERE u.id IS NULL) AS missing_auth_users,
    (SELECT count(*)::int FROM public.sa_ical_subscriptions WHERE scope='employee-current-dept' AND owner_emp_no IS NULL) AS personal_links_without_owner,
    (SELECT count(*)::int FROM public.sa_ical_subscriptions) AS calendar_subscriptions,
    (SELECT count(*)::int FROM storage.objects) AS files,
    (SELECT count(*)::int FROM cron.job WHERE active) AS active_cron_jobs`)).rows[0];
  await database.query('ROLLBACK');
  const passed = results.every(r => r.match) && authIdsMatch && references.missing_auth_users === 0
    && references.personal_links_without_owner === 0 && references.files === 90 && references.active_cron_jobs === 0;
  const report = { passed, checkedAt: new Date().toISOString(), targetRef, tables: results, authUsersVisibleInApi: users,
    sourceAuthUsersVisibleInApi: sourceIds.length, authIdsMatch,
    references, note: 'Read-only admin API checks; no password sign-in, email, callback, or live application cutover performed.' };
  await writeFile(path.join(directory, 'target-api-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (database) await database.end().catch(() => {});
}
