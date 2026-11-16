// Tests of ops/pc/local-files.mjs: the owner's settings and the program's memory. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseConfig, parseState } from './local-files.mjs';

test('no config file: no backup, so no migration will run', () => {
  assert.deepEqual(parseConfig(undefined), { backup: undefined, allowDestructiveMigrations: [] });
});

test('reads the backup command, with its default time', () => {
  const config = parseConfig(
    JSON.stringify({
      backup: { command: 'powershell.exe', args: ['-NoProfile', '-File', 'sauvegarde.ps1'] },
    }),
  );
  assert.deepEqual(config.backup, {
    command: 'powershell.exe',
    args: ['-NoProfile', '-File', 'sauvegarde.ps1'],
    timeoutMinutes: 30,
  });
});

test('refuses a config it does not fully understand', () => {
  assert.throws(() => parseConfig('[]'), /un objet/);
  assert.throws(() => parseConfig(JSON.stringify({ backups: {} })), /champ inconnu « backups »/);
  assert.throws(() => parseConfig(JSON.stringify({ backup: { command: '' } })), /backup\.command/);
  assert.throws(() => parseConfig(JSON.stringify({ backup: { command: 'x', args: 'y' } })), /backup\.args/);
  assert.throws(() => parseConfig(JSON.stringify({ backup: { command: 'x', timeoutMinutes: 0 } })), /entier/);
  assert.throws(() => parseConfig(JSON.stringify({ allowDestructiveMigrations: [1] })), /liste/);
});

test('forgets a state it cannot read rather than trusting it', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(parseState('not json'), {
    builtCommit: undefined,
    migratedCommit: undefined,
    failedCommit: undefined,
    updatedAt: undefined,
  });
  const state = parseState(JSON.stringify({ builtCommit: commit, migratedCommit: 'abc', updatedAt: 'hier' }));
  assert.equal(state.builtCommit, commit);
  assert.equal(state.migratedCommit, undefined);
  assert.equal(state.updatedAt, undefined);
});
