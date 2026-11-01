// Tests of scripts/staged-check.mjs. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { stagedFor } from './staged-check.mjs';

const git = (...paths) => `${paths.join('\0')}\0`;

test('keeps the files of each check by extension, as the hooks did', () => {
  const output = git('apps/web/src/a.tsx', 'packages/db/b.ts', 'docs/c.md', 'lefthook.yml', 'scripts/d.mjs');
  assert.deepEqual(stagedFor('lint', output), ['apps/web/src/a.tsx', 'packages/db/b.ts']);
  assert.deepEqual(stagedFor('format', output), [
    'apps/web/src/a.tsx',
    'packages/db/b.ts',
    'lefthook.yml',
    'scripts/d.mjs',
  ]);
});

test('reads paths with spaces and accents whole (NUL-separated), and nothing from an empty index', () => {
  assert.deepEqual(stagedFor('lint', git('dossier un/fiché.ts')), ['dossier un/fiché.ts']);
  assert.deepEqual(stagedFor('format', ''), []);
  assert.deepEqual(stagedFor('lint', git('ts', '.github/ts', 'Dockerfile')), []);
});

test('takes thousands of files: the list never goes on a command line', () => {
  const many = Array.from({ length: 5000 }, (_, i) => `packages/contracts/src/file-${String(i)}.ts`);
  assert.equal(stagedFor('lint', git(...many)).length, 5000);
});
