import { loadEnvFile } from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { settings, sourceRef, safeError } from './connection.mjs';

const directory = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z/storage');
let stage = 'configuration';
let database;
try {
  const source = settings('SOURCE');
  loadEnvFile('.env.local');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  if (url !== `https://${sourceRef}.supabase.co` || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SOURCE_API_CONFIGURATION_MISSING');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  database = source.client();
  await database.connect();
  await database.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const buckets = (await database.query('SELECT * FROM storage.buckets ORDER BY id')).rows;
  const objects = (await database.query('SELECT * FROM storage.objects ORDER BY id')).rows;
  await database.query('ROLLBACK');
  await database.end();
  database = null;
  await mkdir(directory, { recursive: true });
  let totalBytes = 0;
  const downloaded = [];
  stage = 'storage-download';
  for (const object of objects) {
    if (!/^[0-9a-f-]{36}$/i.test(object.id)) throw new Error('INVALID_OBJECT_ID');
    const response = await supabase.storage.from(object.bucket_id).download(object.name);
    if (response.error) throw new Error('STORAGE_DOWNLOAD_FAILED');
    const contents = Buffer.from(await response.data.arrayBuffer());
    await writeFile(path.join(directory, `${object.id}.bin`), contents, { mode: 0o600, flag: 'wx' });
    downloaded.push({ ...object, backupFile: `${object.id}.bin`, bytes: contents.length,
      sha256: createHash('sha256').update(contents).digest('hex') });
    totalBytes += contents.length;
    if (downloaded.length % 15 === 0) console.log(JSON.stringify({ downloaded: downloaded.length, total: objects.length }));
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ sourceRef, capturedAt: new Date().toISOString(),
    independentOfDatabaseBackupSnapshot: true, buckets, objects: downloaded }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: 'storage-backup-created', buckets: buckets.length, files: downloaded.length, bytes: totalBytes, targetChanged: false }));
} catch (error) {
  console.error(JSON.stringify(safeError(error, stage)));
  process.exitCode = 1;
} finally {
  if (database) await database.end().catch(() => {});
}
