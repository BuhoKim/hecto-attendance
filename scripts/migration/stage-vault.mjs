import { settings, safeError } from './connection.mjs';

let source, target;
let stage = 'configuration';
try {
  source = settings('SOURCE').client();
  target = settings('TARGET').client();
  await source.connect();
  await target.connect();
  stage = 'source-read';
  await source.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const secrets = (await source.query('SELECT id, name, description, decrypted_secret, created_at, updated_at FROM vault.decrypted_secrets ORDER BY id')).rows;
  await source.query('ROLLBACK');
  for (const secret of secrets) {
    const references = (await source.query(`SELECT
      EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%' || $1::text || '%') AS cron,
      EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prosrc LIKE '%' || $1::text || '%') AS function`, [secret.id])).rows[0];
    if (!secret.name || references.cron || references.function) throw new Error('VAULT_UUID_REVIEW_REQUIRED');
  }
  stage = 'target-transaction';
  await target.query('BEGIN');
  if ((await target.query('SELECT count(*)::int AS count FROM vault.secrets')).rows[0].count) throw new Error('TARGET_VAULT_NOT_EMPTY');
  for (const secret of secrets) {
    // Use the supported API, re-encrypting with the destination's encryption key.
    // The name is preserved; a new Vault UUID is allocated, with no known SQL/cron UUID references.
    const id = (await target.query('SELECT vault.create_secret($1,$2,$3) AS id',
      [secret.decrypted_secret, secret.name, secret.description])).rows[0].id;
    const restored = (await target.query('SELECT decrypted_secret FROM vault.decrypted_secrets WHERE id=$1', [id])).rows[0];
    if (restored?.decrypted_secret !== secret.decrypted_secret) throw new Error('VAULT_VERIFY_FAILED');
  }
  await target.query('COMMIT');
  console.log(JSON.stringify({ status: 'vault-staged', secrets: secrets.length, namePreserved: true, uuidPreserved: false,
    plaintextEqualityVerified: true, sourceChanged: false, cronActivated: false,
    note: 'Any values referring to old API keys or endpoints still require cutover review.' }));
} catch (error) {
  if (target) await target.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (source) await source.end().catch(() => {});
  if (target) await target.end().catch(() => {});
}
