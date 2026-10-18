import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { settings, quoteIdentifier, safeError } from './connection.mjs';

const pgBin = path.resolve('.migration-private/tools/pgsql/bin');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const directory = path.resolve('.migration-private/backups', stamp);
let stage = 'configuration';
let client;
try {
  const backupLabel = process.argv.includes('--target') ? 'TARGET' : 'SOURCE';
  const source = settings(backupLabel);
  client = source.client();
  stage = 'source-connect';
  await client.connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL statement_timeout = '10min'");
  const snapshot = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
  const tables = (await client.query(`SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','auth','storage','vault','supabase_migrations','cron')
    AND c.relkind IN ('r','p') ORDER BY 1,2`)).rows;
  for (const table of tables) {
    const rows = (await client.query(`SELECT count(*)::text AS count FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`)).rows;
    table.rows = rows[0].count;
  }
  await mkdir(directory, { recursive: true });
  const archive = path.join(directory, `${backupLabel.toLowerCase()}.dump`);
  stage = 'pg-dump';
  await new Promise((resolve, reject) => {
    const child = spawn(path.join(pgBin, 'pg_dump.exe'), ['--format=custom', '--no-owner',
      '--snapshot', snapshot, '--file', archive, '--lock-wait-timeout=30s'],
    { env: { ...source.pgEnv, PGOPTIONS: '-c default_transaction_read_only=on' }, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.stdout.resume();
    child.on('error', reject);
    child.on('close', async code => {
      if (stderr) await writeFile(path.join(directory, 'pg-dump.log'), stderr, { mode: 0o600 });
      if (code === 0) resolve(); else reject(Object.assign(new Error('PG_DUMP_FAILED'), { code: 'PG_DUMP_FAILED' }));
    });
  });
  await client.query('ROLLBACK');
  const contents = await readFile(archive);
  if (contents.subarray(0, 5).toString() !== 'PGDMP') throw new Error('INVALID_ARCHIVE');
  const manifest = { sourceRef: source.ref, backupLabel, capturedAt: stamp, consistentSnapshot: true,
    archiveBytes: (await stat(archive)).size, sha256: createHash('sha256').update(contents).digest('hex'),
    tables, note: 'Database archive only. Storage object bytes and project configuration require separate backup.' };
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'database-backup-created', directory, bytes: manifest.archiveBytes,
    sha256: manifest.sha256, tables: tables.length, targetChanged: false }));
} catch (error) {
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
