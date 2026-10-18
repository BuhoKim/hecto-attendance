import { spawnSync } from 'node:child_process';
import { mkdir, copyFile, lstat, writeFile, readlink } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const destination = path.resolve('.migration-private/backups/2026-10-15T06-07-42-130Z/worktree');
const list = spawnSync('git', ['ls-files','-c','-o','--exclude-standard','-z'], { encoding: 'utf8', windowsHide: true });
if (list.status !== 0) throw new Error('GIT_LIST_FAILED');
await mkdir(destination, { recursive: true });
const excluded = [], symlinks = [], copied = [];
for (const file of new Set(list.stdout.split('\0').filter(Boolean))) {
  const source = path.resolve(file);
  const output = path.resolve(destination, file);
  if (!source.startsWith(root + path.sep) || !output.startsWith(destination + path.sep)) throw new Error('UNSAFE_PATH');
  let metadata;
  try { metadata = await lstat(source); } catch (error) { if (error.code === 'ENOENT') { excluded.push(file); continue; } throw error; }
  if (metadata.isSymbolicLink()) { symlinks.push({ path: file, target: await readlink(source) }); continue; }
  if (!metadata.isFile()) continue;
  await mkdir(path.dirname(output), { recursive: true });
  await copyFile(source, output);
  copied.push(file);
}
await writeFile(path.join(destination, 'backup-manifest.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
  files: copied, deletedOrMissing: excluded, symlinks, gitIgnoredFilesExcluded: true }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ status: 'worktree-backup-created', files: copied.length,
  missing: excluded.length, symlinks: symlinks.length, secretEnvFilesCopied: false }));
