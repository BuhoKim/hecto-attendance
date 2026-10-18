import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { settings, targetRef, safeError } from './connection.mjs';

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/migration/stage-storage.mjs\nRequires TARGET_SUPABASE_SERVICE_ROLE_KEY in .env.migration.local. Copies verified backups into private buckets, downloads each uploaded file, and compares SHA-256. Does not activate apps or change the source.');
  process.exit(0);
}
const directory = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z/storage');
let database;
let stage = 'configuration';
try {
  const target = settings('TARGET');
  const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('TARGET_STORAGE_KEY_MISSING');
  if (!key.startsWith('sb_secret_')) {
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
    if (payload.role !== 'service_role' || payload.ref !== targetRef) throw new Error('TARGET_STORAGE_KEY_WRONG_PROJECT');
  }
  const supabase = createClient(`https://${targetRef}.supabase.co`, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  // Validate every local file before mutating the destination.
  for (const object of manifest.objects) {
    if (!/^[0-9a-f-]{36}\.bin$/i.test(object.backupFile)) throw new Error('INVALID_BACKUP_FILE');
    const contents = await readFile(path.join(directory, object.backupFile));
    if (contents.length !== object.bytes || createHash('sha256').update(contents).digest('hex') !== object.sha256) throw new Error('LOCAL_FILE_HASH_MISMATCH');
  }
  database = target.client();
  await database.connect();
  stage = 'create-private-buckets';
  for (const bucket of manifest.buckets) {
    const current = await supabase.storage.getBucket(bucket.id);
    if (current.data) {
      if (current.data.public) throw new Error('STAGING_BUCKET_NOT_PRIVATE');
    } else {
      if (current.error && !['404', '400'].includes(String(current.error.statusCode || current.error.status))) throw new Error('BUCKET_LOOKUP_FAILED');
      const created = await supabase.storage.createBucket(bucket.id, { public: false,
        ...(bucket.file_size_limit ? { fileSizeLimit: bucket.file_size_limit } : {}),
        ...(bucket.allowed_mime_types ? { allowedMimeTypes: bucket.allowed_mime_types } : {}) });
      if (created.error) throw new Error('BUCKET_CREATE_FAILED');
    }
  }
  const verified = [];
  stage = 'upload-and-verify';
  for (const object of manifest.objects) {
    const existing = (await database.query('SELECT id FROM storage.objects WHERE bucket_id=$1 AND name=$2', [object.bucket_id, object.name])).rows[0];
    let id = existing?.id;
    if (!existing) {
      const contents = await readFile(path.join(directory, object.backupFile));
      const upload = await supabase.storage.from(object.bucket_id).upload(object.name, contents, {
        upsert: false, contentType: object.metadata?.mimetype || 'application/octet-stream',
        cacheControl: String(object.metadata?.cacheControl || '3600').replace(/^max-age=/, ''),
        metadata: object.user_metadata || {} });
      if (upload.error) throw new Error('UPLOAD_FAILED');
      id = upload.data.id;
    }
    const download = await supabase.storage.from(object.bucket_id).download(object.name);
    if (download.error) throw new Error('UPLOADED_FILE_READ_FAILED');
    const bytes = Buffer.from(await download.data.arrayBuffer());
    if (bytes.length !== object.bytes || createHash('sha256').update(bytes).digest('hex') !== object.sha256) throw new Error('UPLOADED_FILE_HASH_MISMATCH');
    // Storage keeps its own backing-object identifiers and version metadata.
    // Preserve the logical path, original ownership, user metadata and timestamps.
    await database.query(`UPDATE storage.objects SET owner=$1,owner_id=$2,created_at=$3,
      updated_at=$4,last_accessed_at=$5,user_metadata=$6 WHERE bucket_id=$7 AND name=$8`,
    [object.owner, object.owner_id, object.created_at, object.updated_at, object.last_accessed_at,
      object.user_metadata || {}, object.bucket_id, object.name]);
    verified.push({ sourceObjectId: object.id, targetObjectId: id, bucket: object.bucket_id,
      path: object.name, bytes: object.bytes, sha256: object.sha256 });
    if (verified.length % 15 === 0) console.log(JSON.stringify({ verified: verified.length, total: manifest.objects.length }));
  }
  await writeFile(path.join(directory, 'target-verification.json'), JSON.stringify({ targetRef,
    checkedAt: new Date().toISOString(), allFileHashesMatch: true, bucketsRemainPrivate: true,
    originalBucketPublicFlags: manifest.buckets.map(b => ({ id: b.id, public: b.public })), objects: verified }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'storage-staged', files: verified.length,
    buckets: manifest.buckets.length, allFileHashesMatch: true, publicBuckets: false, sourceChanged: false }));
} catch (error) {
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (database) await database.end().catch(() => {});
}
