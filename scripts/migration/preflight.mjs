import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const sourceRef = 'gbfoempwoeurhhlxqxgy';
const targetRef = 'qcpqcuzvirmbjzqjzapt';
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/migration/preflight.mjs [--counts]\nReads .env.migration.local. Read-only metadata; --counts adds exact public table counts. No data export or restore.');
  process.exit(0);
}
const counts = process.argv.includes('--counts');
const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;
let stage = 'configuration';

function connection(value, ref, label) {
  if (!value || value.includes('YOUR-PASSWORD')) throw new Error(`${label}_MISSING`);
  let parsed;
  try { parsed = new URL(value); } catch {
    // Accept an unencoded password only for the fixed Supabase URI structure.
    // Keep the original secret in the ignored env file; encode only in memory.
    const raw = value.match(/^postgres(?:ql)?:\/\/(postgres(?:\.[a-z]{20})?):(.+)@(db\.[a-z]{20}\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com):5432\/postgres$/);
    if (!raw) throw new Error(`${label}_INVALID_URL`);
    parsed = new URL(`postgresql://${raw[1]}:${encodeURIComponent(raw[2])}@${raw[3]}:5432/postgres`);
  }
  const directHost = `db.${ref}.supabase.co`;
  const isPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname);
  const isDirect = parsed.hostname === directHost && parsed.username === 'postgres';
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !(isDirect || (isPooler && parsed.username === `postgres.${ref}`))
    || (parsed.port && parsed.port !== '5432') || parsed.pathname !== '/postgres'
    || !parsed.password) throw new Error(`${label}_WRONG_PROJECT_OR_CONNECTION`);
  // URL SSL options must not override certificate verification below.
  parsed.search = '';
  const ssl = { rejectUnauthorized: true };
  if (process.env.MIGRATION_CA_FILE) ssl.ca = readFileSync(process.env.MIGRATION_CA_FILE, 'utf8');
  return new pg.Client({ connectionString: parsed.toString(), ssl, connectionTimeoutMillis: 15000,
    application_name: 'company-transfer-readonly-preflight' });
}

async function inspect(client, label, ref) {
  stage = label;
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '60s'");
    const { rows: tables } = await client.query(`SELECT n.nspname AS schema, c.relname AS name,
      c.relrowsecurity AS rls, c.reltuples::bigint AS estimated_rows
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
    if (counts) {
      for (const table of tables) {
        const result = await client.query(`SELECT count(*)::text AS count FROM ${quoteIdentifier(table.schema)}.${quoteIdentifier(table.name)}`);
        table.exact_rows = result.rows[0].count;
      }
    }
    const { rows: extensions } = await client.query('SELECT extname AS name, extversion AS version FROM pg_extension ORDER BY extname');
    const { rows: summary } = await client.query(`SELECT current_setting('server_version') AS version,
      (SELECT count(*)::text FROM auth.users) AS auth_users,
      (SELECT count(*)::text FROM storage.buckets) AS storage_buckets,
      (SELECT count(*)::text FROM storage.objects) AS storage_objects`);
    const { rows: schemas } = await client.query(`SELECT nspname AS name FROM pg_namespace
      WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname`);
    await client.query('ROLLBACK');
    return { label, ref, capturedAt: new Date().toISOString(), countsAreConsistentWithinThisDatabase: true,
      ...summary[0], schemas, extensions, tables };
  } finally {
    await client.end().catch(() => {});
  }
}

try {
  loadEnvFile('.env.migration.local');
  // Validate both destinations before making any database connection.
  const source = connection(process.env.SOURCE_DATABASE_URL, sourceRef, 'SOURCE');
  const target = connection(process.env.TARGET_DATABASE_URL, targetRef, 'TARGET');
  const original = await inspect(source, 'source', sourceRef);
  const destination = await inspect(target, 'target', targetRef);
  console.log(JSON.stringify({ readOnly: true, counts, source: original, target: destination,
    note: 'Separate snapshots; matching counts alone do not prove a complete migration. No credentials or row contents are output.' }, null, 2));
} catch (error) {
  const configCode = /^(SOURCE|TARGET)_(MISSING|INVALID_URL|WRONG_PROJECT_OR_CONNECTION)$/.test(error.message || '') ? error.message : null;
  const safeCode = /^[A-Z0-9_]{2,64}$/.test(String(error.code || '')) ? error.code : 'CHECK_FAILED';
  console.error(JSON.stringify({ stage, code: configCode || safeCode,
    message: '점검 중단. .env.migration.local의 연결정보·인증서·네트워크를 확인하세요. 비밀번호 보호를 위해 원본 오류는 출력하지 않습니다.' }));
  process.exitCode = 1;
}
