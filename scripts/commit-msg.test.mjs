// Tests of scripts/commit-msg.mjs. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isConventional } from './commit-msg.mjs';

test('accepts a Conventional Commit, with or without a scope, and a merge', () => {
  assert.ok(isConventional('fix(test): pass on Windows\n\nbody'));
  assert.ok(isConventional('feat!: drop the old route'));
  assert.ok(isConventional('Merge branch main'));
});

test('reads only the first line, whatever the line endings', () => {
  assert.ok(isConventional('docs: one line\r\nnot: checked'));
});

test('refuses a free-form first line, an unknown type or a line over 72 characters after the type', () => {
  assert.equal(isConventional('Fixed the tests'), false);
  assert.equal(isConventional('feature: something'), false);
  assert.equal(isConventional(`fix: ${'x'.repeat(73)}`), false);
});
