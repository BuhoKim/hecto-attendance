import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settings, safeError, quoteIdentifier } from './connection.mjs';

const directory = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z');
const pgBin = path.resolve('.migration-private/tools/pgsql/bin');
let stage = 'configuration';
let client;
const run = (exe, args, env) => new Promise((resolve, reject) => {
  const child = spawn(path.join(pgBin, exe), args, { env, windowsHide: true });
  const output = [];
  child.stdout.on('data', chunk => output.push(chunk));
  child.stderr.resume();
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(Buffer.concat(output).toString('utf8')) : reject(new Error('VERIFY_TOOL_FAILED')));
});

function copyTables(sql) {
  const result = new Map();
  let current = null;
  for (const line of sql.split(/\r?\n/)) {
    const header = line.match(/^COPY (.+) \((.+)\) FROM stdin;$/);
    if (header) {
      current = { columns: header[2].split(', '), rows: [] };
      result.set(header[1], current);
    } else if (line === '\\.') current = null;
    else if (current) current.rows.push(line);
  }
  return result;
}

function digest(rows) {
  const hash = createHash('sha256');
  for (const row of rows.map(row => createHash('sha256').update(row).digest('hex')).sort()) hash.update(`${row}\n`);
  return hash.digest('hex');
}

try {
  const target = settings('TARGET');
  stage = 'compare-backup';
  const original = copyTables(await run('pg_restore.exe', ['--data-only', '--schema=public', '--schema=auth', '--file=-', path.join(directory, 'source.dump')], target.pgEnv));
  const restored = copyTables(await run('pg_dump.exe', ['--data-only', '--schema=public', '--schema=auth', '--exclude-table=auth.schema_migrations', '--no-owner', '--no-privileges'], { ...target.pgEnv, PGOPTIONS: '-c default_transaction_read_only=on' }));
  const checks = [];
  for (const [name, expected] of original) {
    if (name === 'auth.schema_migrations') continue;
    const actual = restored.get(name);
    if (!actual) { checks.push({ table: name, match: false, reason: 'table-missing' }); continue; }
    const indexes = expected.columns.map(column => actual.columns.indexOf(column));
    if (indexes.includes(-1)) { checks.push({ table: name, match: false, reason: 'column-missing' }); continue; }
    const rows = actual.rows.map(row => {
      const values = row.split('\t');
      return indexes.map(index => values[index]).join('\t');
    });
    checks.push({ table: name, expectedRows: expected.rows.length, actualRows: actual.rows.length,
      match: digest(expected.rows) === digest(rows) });
  }
  stage = 'permissions';
  client = target.client();
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  const permission = (await client.query(`SELECT has_schema_privilege('anon','public','USAGE') AS anon_public_usage,
    has_schema_privilege('authenticated','public','USAGE') AS authenticated_public_usage,
    (SELECT count(*)::int FROM cron.job WHERE active) AS active_cron_jobs,
    (SELECT count(*)::int FROM auth.users) AS auth_users,
    (SELECT rolcanlogin FROM pg_roles WHERE rolname='hr_hub_readonly') AS hr_hub_login`)).rows[0];
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const rowCounts = [];
  for (const table of manifest.tables.filter(t => t.schema === 'public')) {
    const actual = (await client.query(`SELECT count(*)::text AS count FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`)).rows[0].count;
    rowCounts.push({ table: table.name, match: actual === table.rows, rows: actual });
  }
  await client.query('ROLLBACK');
  const passed = checks.every(check => check.match) && rowCounts.every(check => check.match)
    && !permission.anon_public_usage && !permission.authenticated_public_usage
    && permission.active_cron_jobs === 0 && permission.auth_users === 21 && !permission.hr_hub_login;
  const report = { checkedAt: new Date().toISOString(), backupSnapshot: manifest.capturedAt, passed,
    copyComparisons: checks, rowCounts, permission, liveSourceComparison: false };
  await writeFile(path.join(directory, 'stage-verification.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ passed, comparedTables: checks.length, publicTables: rowCounts.length,
    mismatches: checks.filter(check => !check.match).map(check => ({ table: check.table, reason: check.reason || 'rows-or-content' })),
    permission, comparisonBasis: 'original backup snapshot, not the changing production source' }));
  if (!passed) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (client) await client.end().catch(() => {});
}
