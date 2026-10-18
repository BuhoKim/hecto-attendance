import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settings, targetRef, safeError } from './connection.mjs';

const directory = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z/storage');
let stage = 'configuration';
let database;
try {
  const backup = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const upload = JSON.parse(await readFile(path.join(directory, 'target-verification.json'), 'utf8'));
  if (upload.targetRef !== targetRef || !upload.allFileHashesMatch || upload.objects.length !== backup.objects.length) throw new Error('UPLOAD_NOT_VERIFIED');
  for (const object of backup.objects) {
    const actual = upload.objects.find(entry => entry.bucket === object.bucket_id && entry.path === object.name);
    if (!actual || actual.sha256 !== object.sha256 || actual.bytes !== object.bytes) throw new Error('FILE_MANIFEST_MISMATCH');
  }
  database = settings('TARGET').client();
  await database.connect();
  stage = 'restore-metadata';
  // The regular Storage update trigger replaces updated_at with now(). Restore the
  // original timestamps within this transaction without altering persistent triggers.
  await database.query('BEGIN');
  await database.query('SET LOCAL session_replication_role = replica');
  for (const object of backup.objects) {
    const updated = await database.query(`UPDATE storage.objects SET owner=$1,owner_id=$2,
      created_at=$3,updated_at=$4,last_accessed_at=$5,user_metadata=$6
      WHERE bucket_id=$7 AND name=$8`, [object.owner, object.owner_id, object.created_at,
      object.updated_at, object.last_accessed_at, object.user_metadata,
      object.bucket_id, object.name]);
    if (updated.rowCount !== 1) throw new Error('STORAGE_OBJECT_MISSING');
    const matches = (await database.query(`SELECT owner IS NOT DISTINCT FROM $1::uuid
      AND owner_id IS NOT DISTINCT FROM $2::text
      AND created_at IS NOT DISTINCT FROM $3::timestamptz
      AND updated_at IS NOT DISTINCT FROM $4::timestamptz
      AND last_accessed_at IS NOT DISTINCT FROM $5::timestamptz
      AND user_metadata IS NOT DISTINCT FROM $6::jsonb AS matches
      FROM storage.objects WHERE bucket_id=$7 AND name=$8`, [object.owner, object.owner_id,
      object.created_at, object.updated_at, object.last_accessed_at, object.user_metadata,
      object.bucket_id, object.name])).rows[0]?.matches;
    if (!matches) throw new Error('OBJECT_METADATA_MISMATCH');
  }
  const summary = (await database.query(`SELECT
    (SELECT count(*)::int FROM storage.objects) AS files,
    (SELECT count(*)::int FROM storage.buckets) AS buckets,
    (SELECT count(*)::int FROM storage.buckets WHERE public) AS public_buckets,
    has_schema_privilege('anon','public','USAGE') AS anon_public_usage,
    has_schema_privilege('authenticated','public','USAGE') AS authenticated_public_usage,
    (SELECT count(*)::int FROM cron.job WHERE active) AS active_cron_jobs`)).rows[0];
  if (summary.files !== backup.objects.length || summary.buckets !== backup.buckets.length
    || summary.public_buckets || summary.anon_public_usage || summary.authenticated_public_usage
    || summary.active_cron_jobs) throw new Error('STAGING_STATE_MISMATCH');
  await database.query('COMMIT');
  const result = { status: 'storage-verification-passed', checkedAt: new Date().toISOString(),
    allFileHashesMatch: true, ownershipAndTimestampsMatch: true, sourceChanged: false, ...summary };
  await writeFile(path.join(directory, 'final-verification.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result));
} catch (error) {
  if (database) await database.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (database) await database.end().catch(() => {});
}
