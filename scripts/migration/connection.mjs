import { loadEnvFile } from 'node:process';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export const sourceRef = 'gbfoempwoeurhhlxqxgy';
export const targetRef = 'qcpqcuzvirmbjzqjzapt';
export const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

export function settings(label) {
  loadEnvFile('.env.migration.local');
  const ref = label === 'SOURCE' ? sourceRef : label === 'TARGET' ? targetRef : null;
  if (!ref) throw new Error('INVALID_LABEL');
  const value = process.env[`${label}_DATABASE_URL`];
  if (!value || value.includes('YOUR-PASSWORD')) throw new Error(`${label}_MISSING`);
  let parsed;
  try { parsed = new URL(value); } catch {
    const raw = value.match(/^postgres(?:ql)?:\/\/(postgres(?:\.[a-z]{20})?):(.+)@(db\.[a-z]{20}\.supabase\.co|[a-z0-9-]+\.pooler\.supabase\.com):5432\/postgres$/);
    if (!raw) throw new Error(`${label}_INVALID_URL`);
    parsed = new URL(`postgresql://${raw[1]}:${encodeURIComponent(raw[2])}@${raw[3]}:5432/postgres`);
  }
  const direct = parsed.hostname === `db.${ref}.supabase.co` && parsed.username === 'postgres';
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(parsed.hostname) && parsed.username === `postgres.${ref}`;
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !(direct || pooler)
    || (parsed.port && parsed.port !== '5432') || parsed.pathname !== '/postgres' || !parsed.password) {
    throw new Error(`${label}_WRONG_PROJECT_OR_CONNECTION`);
  }
  parsed.search = '';
  const caFile = process.env[`${label}_CA_FILE`] || process.env.MIGRATION_CA_FILE;
  const ssl = { rejectUnauthorized: true };
  if (caFile) ssl.ca = readFileSync(caFile, 'utf8');
  const client = () => new pg.Client({ connectionString: parsed.toString(), ssl,
    connectionTimeoutMillis: 15000, application_name: 'company-transfer' });
  const pgEnv = { ...process.env, PGHOST: parsed.hostname, PGPORT: parsed.port || '5432',
    PGUSER: decodeURIComponent(parsed.username), PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: 'postgres', PGSSLMODE: 'verify-full', PGCONNECT_TIMEOUT: '15',
    ...(caFile ? { PGSSLROOTCERT: caFile } : {}) };
  return { ref, client, pgEnv };
}

export function safeError(error, stage) {
  const code = /^[A-Z0-9_]{2,64}$/.test(String(error.code || error.message || ''))
    ? String(error.code || error.message) : 'CHECK_FAILED';
  return { stage, code, message: '작업 중단. 비밀번호·행 데이터 보호를 위해 원본 오류는 출력하지 않습니다.' };
}
