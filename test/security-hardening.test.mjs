import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicErrorMessage } from '../src/lib/apiError.mjs';

test('internal errors become a safe public API message', () => {
  assert.equal(
    publicErrorMessage(new Error('PostgREST relation sa_profiles does not exist'), '서버 오류가 발생했습니다.'),
    '서버 오류가 발생했습니다.'
  );
});

test('layout does not require remote Google Fonts during build', async () => {
  const layout = await readFile(new URL('../src/app/layout.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../src/app/globals.css', import.meta.url), 'utf8');

  assert.doesNotMatch(layout, /next\/font\/google/);
  assert.doesNotMatch(styles, /@import\s+url\(['"]https?:/);
});
