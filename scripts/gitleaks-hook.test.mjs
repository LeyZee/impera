// Tests of scripts/gitleaks-hook.mjs. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { MISSING, scanFor } from './gitleaks-hook.mjs';

const SCRIPT = fileURLToPath(new URL('./gitleaks-hook.mjs', import.meta.url));

test('scans the staged changes before a commit, redacted', () => {
  assert.deepEqual(scanFor('staged'), ['git', '--pre-commit', '--staged', '--redact', '--verbose']);
});

test('scans before a push every local commit that no branch of origin holds, redacted', () => {
  const args = scanFor('push');
  assert.ok(args?.includes('--log-opts=--branches --not --remotes=origin'));
  assert.ok(args.includes('--redact'));
});

test('knows no other scan', () => {
  assert.equal(scanFor('all'), null);
  assert.equal(scanFor('toString'), null);
});

test('stops the hook with the way to install gitleaks when it is not on the PATH', () => {
  const run = spawnSync(process.execPath, [SCRIPT, 'staged'], {
    env: { ...process.env, PATH: '' },
    encoding: 'utf8',
  });
  assert.equal(run.status, 1);
  assert.ok(run.stderr.includes(MISSING));
});

const hasGitleaks = spawnSync('gitleaks', ['version']).error === undefined;

test('refuses a push that carries an invented secret', { skip: !hasGitleaks && 'gitleaks absent' }, () => {
  const repo = mkdtempSync(join(tmpdir(), 'nirvana-gitleaks-'));
  const git = (...args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    writeFileSync(join(repo, 'README.md'), 'rien\n');
    git('add', '.');
    git('commit', '-q', '-m', 'clean');
    const scan = () => spawnSync(process.execPath, [SCRIPT, 'push'], { cwd: repo, encoding: 'utf8' }).status;
    assert.equal(scan(), 0);
    // An invented key in the shape of a real provider's (ADR 0010: nothing real).
    writeFileSync(
      join(repo, 'config.ts'),
      `const key = '${['sk', 'live', 'Nv7qR2xKp9LmT4wZ8cYb3HdF'].join('_')}';\n`,
    );
    git('add', '.');
    git('commit', '-q', '-m', 'leak');
    assert.equal(scan(), 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
