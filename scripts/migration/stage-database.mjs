import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { settings, safeError, sourceRef } from './connection.mjs';

const backupDirectory = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z');
const archive = path.join(backupDirectory, 'source.dump');
const pgBin = path.resolve('.migration-private/tools/pgsql/bin');
let stage = 'configuration';
let target;
const run = (executable, args, env) => new Promise((resolve, reject) => {
  const child = spawn(path.join(pgBin, executable), args, { env, windowsHide: true });
  const out = [], err = [];
  child.stdout.on('data', data => out.push(data));
  child.stderr.on('data', data => err.push(data));
  child.on('error', reject);
  child.on('close', async code => {
    try {
      if (err.length) await writeFile(path.join(backupDirectory, `${executable}.stage.log`), Buffer.concat(err), { mode: 0o600 });
      if (code !== 0) throw new Error('RESTORE_TOOL_FAILED');
      resolve(Buffer.concat(out));
    } catch (error) { reject(error); }
  });
});

try {
  const destination = settings('TARGET');
  const manifest = JSON.parse(await readFile(path.join(backupDirectory, 'manifest.json'), 'utf8'));
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  if (manifest.sourceRef !== sourceRef || hash !== manifest.sha256) throw new Error('ARCHIVE_MISMATCH');
  target = destination.client();
  stage = 'target-preflight';
  await target.connect();
  const initial = (await target.query(`SELECT
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p')) AS tables,
    (SELECT count(*)::int FROM auth.users) AS users,
    (SELECT count(*)::int FROM storage.objects) AS objects,
    (SELECT count(*)::int FROM storage.buckets) AS buckets,
    to_regnamespace('supabase_migrations') IS NOT NULL AS history`)).rows[0];
  if (initial.tables || initial.users || initial.objects || initial.buckets || initial.history) throw new Error('TARGET_NOT_EMPTY');
  await target.end();
  target = null;
  stage = 'restore-plan';
  const toc = (await run('pg_restore.exe', ['--list', archive], destination.pgEnv)).toString('utf8');
  const selected = toc.split(/\r?\n/).filter(line => {
    if (!/^\d+;/.test(line)) return false;
    // New Supabase manages its own administrator defaults; postgres cannot alter them.
    if (/\bDEFAULT ACL public .* supabase_admin$/.test(line)) return false;
    if (/\b(?:SCHEMA - supabase_migrations|ACL - SCHEMA public)\b/.test(line)) return true;
    if (/\b(?:TYPE|DOMAIN|FUNCTION|PROCEDURE|TABLE|SEQUENCE|DEFAULT|CONSTRAINT|INDEX|TRIGGER|RULE|POLICY|ROW SECURITY|ACL|COMMENT|DEFAULT ACL|FK CONSTRAINT|TABLE DATA|SEQUENCE SET|SEQUENCE OWNED BY) (?:public|supabase_migrations) /.test(line)) return true;
    if (/\bTABLE DATA auth /.test(line) && !/\bTABLE DATA auth schema_migrations /.test(line)) return true;
    if (/\bSEQUENCE SET auth /.test(line)) return true;
    return /\bPOLICY storage /.test(line);
  });
  const publicDataEntries = selected.filter(line => /\bTABLE DATA public /.test(line)).length;
  if (publicDataEntries !== manifest.tables.filter(t => t.schema === 'public').length) throw new Error('INCOMPLETE_PUBLIC_PLAN');
  const listFile = path.join(backupDirectory, 'stage.list');
  await writeFile(listFile, selected.join('\n'), { mode: 0o600 });
  const restoreSql = await run('pg_restore.exe', ['--no-owner', '--use-list', listFile, '--file=-', archive], destination.pgEnv);
  const sqlFile = path.join(backupDirectory, 'stage.sql');
  // The transaction only becomes visible with public API access closed and no cron jobs.
  await writeFile(sqlFile, Buffer.concat([
    Buffer.from(`CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\nCREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA public;\nCREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;\nDO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='hr_hub_readonly') THEN CREATE ROLE hr_hub_readonly NOLOGIN NOBYPASSRLS; END IF; END $$;\nSET session_replication_role = replica;\n`),
    restoreSql,
    Buffer.from(`\nSET session_replication_role = origin;\nREVOKE USAGE ON SCHEMA public FROM PUBLIC, anon, authenticated;\nDO $$ BEGIN IF EXISTS (SELECT 1 FROM cron.job WHERE active) THEN RAISE EXCEPTION 'Unexpected active cron job'; END IF; END $$;\n`),
  ]), { mode: 0o600 });
  stage = 'target-transaction';
  await run('psql.exe', ['--no-psqlrc', '--no-password', '--single-transaction', '--set=ON_ERROR_STOP=1',
    '--file', sqlFile], destination.pgEnv);
  console.log(JSON.stringify({ status: 'database-staged', targetRef: destination.ref,
    publicTables: publicDataEntries, originalChanged: false, publicApiAccess: 'blocked', cronActive: false,
    remaining: ['verify-data', 'storage-file-transfer', 'vault', 'edge-functions-and-secrets', 'project-settings', 'hr-hub-role-activation', 'application-cutover'] }));
} catch (error) {
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (target) await target.end().catch(() => {});
}
