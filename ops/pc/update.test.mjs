// Tests of ops/pc/update.mjs (ADR 0125 § 2 and § 4), with a fake repository, pnpm, backup and CRM. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decideAfterHealth, decideUpdate, startImpera, statusFor } from './update.mjs';

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);

const journal = (...tags) =>
  JSON.stringify({ version: '7', entries: tags.map((tag, idx) => ({ idx, tag })) });

/**
 * A PC whose repository is at `head`, with `main` at `upstream` on the remote, and the files of each commit. Every
 * call is recorded in `calls`; `fail` names the steps that fail, `healthyAt` the commits whose CRM answers.
 */
function fakePc({
  head = A,
  upstream = B,
  clean = true,
  branch = 'main',
  online = true,
  ancestor = true,
  files = {},
  state = { builtCommit: A, migratedCommit: A },
  fail = [],
  healthyAt = [A, B],
  noBackup = false,
  allow = [],
} = {}) {
  const calls = [];
  let current = head;
  const written = { state: undefined, status: undefined };
  const step = (name) => () => {
    calls.push(name);
    return Promise.resolve(!fail.includes(name));
  };
  const deps = {
    git: {
      isClean: () => Promise.resolve(clean),
      branch: () => Promise.resolve(branch),
      head: () => Promise.resolve(current),
      fetch: () => Promise.resolve(online),
      upstream: () => Promise.resolve(upstream),
      isAncestor: () => Promise.resolve(ancestor),
      show: (commit, path) => Promise.resolve(files[commit]?.[path]),
      fastForward: (commit) => {
        calls.push(`ff ${commit[0]}`);
        if (fail.includes('ff')) return Promise.resolve(false);
        current = commit;
        return Promise.resolve(true);
      },
      resetTo: (commit) => {
        calls.push(`reset ${commit[0]}`);
        current = commit;
        return Promise.resolve(true);
      },
    },
    install: step('install'),
    build: () => {
      calls.push(`build ${current[0]}`);
      return Promise.resolve(!fail.includes(`build ${current[0]}`));
    },
    stage: step('stage'),
    backup: step('backup'),
    migrate: step('migrate'),
    crm: {
      start: () => {
        calls.push(`start ${current[0]}`);
        return Promise.resolve();
      },
      healthy: () => Promise.resolve(healthyAt.includes(current)),
      stop: () => {
        calls.push('stop');
        return Promise.resolve();
      },
    },
    config: {
      backup: noBackup ? undefined : { command: 'backup.exe', args: [], timeoutMinutes: 30 },
      allowDestructiveMigrations: allow,
    },
    readState: () => ({ failedCommit: undefined, updatedAt: undefined, ...state }),
    writeState: (value) => {
      written.state = value;
    },
    writeStatus: (value) => {
      written.status = value;
    },
    journal: (line) => calls.push(`journal ${line.split(' ').slice(1).join(' ')}`),
    now: () => new Date('2026-11-16T07:12:00Z'),
  };
  return { deps, calls, written, actions: () => calls.filter((call) => !call.startsWith('journal')) };
}

const migrationsAt = (commit, tags, sql = {}) => ({
  [commit]: {
    'packages/db/migrations/meta/_journal.json': journal(...tags),
    ...Object.fromEntries(
      Object.entries(sql).map(([tag, text]) => [`packages/db/migrations/${tag}.sql`, text]),
    ),
  },
});

test('decides from the repository: only a fast-forward of main is an update', () => {
  const base = { clean: true, branch: 'main', fetched: true, head: A, upstream: B, headInUpstream: true };
  assert.deepEqual(decideUpdate(base), { action: 'update', from: A, to: B });
  assert.equal(decideUpdate({ ...base, clean: false }).reason, 'dirty');
  assert.equal(decideUpdate({ ...base, branch: 'task/x' }).reason, 'not_main');
  assert.deepEqual(decideUpdate({ ...base, fetched: false }), {
    action: 'current',
    reason: 'offline',
    tone: 'neutral',
  });
  assert.equal(decideUpdate({ ...base, upstream: A }).reason, 'up_to_date');
  assert.equal(decideUpdate({ ...base, headInUpstream: false }).reason, 'diverged');
  assert.equal(decideUpdate({ ...base, failedCommit: B }).reason, 'known_failed');
  assert.equal(decideUpdate({ ...base, failedCommit: C }).action, 'update');
});

test('after the health check: keep, go back once, then stay stopped', () => {
  assert.equal(decideAfterHealth({ healthy: true, isRollback: false }), 'keep');
  assert.equal(decideAfterHealth({ healthy: false, isRollback: false }), 'rollback');
  assert.equal(decideAfterHealth({ healthy: true, isRollback: true }), 'rolled_back');
  assert.equal(decideAfterHealth({ healthy: false, isRollback: true }), 'stop');
});

test('the status line says the date of the update, or that the previous version runs', () => {
  const now = new Date('2026-11-16T07:12:00Z');
  const updated = statusFor({
    outcome: 'updated',
    reason: 'updated',
    tone: 'neutral',
    commit: B,
    updatedAt: now.toISOString(),
    now,
  });
  assert.equal(updated.line, 'Mis à jour le 16 novembre 2026 à 08:12');
  assert.equal(updated.commit, 'bbbbbbb');
  const back = statusFor({ outcome: 'rolled_back', reason: 'unhealthy', tone: 'amber', commit: A, now });
  assert.equal(back.line, 'Mise à jour échouée, version précédente');
  assert.equal(
    statusFor({ outcome: 'current', reason: 'offline', tone: 'neutral', now }).line,
    'Version présente',
  );
});

test('nothing new: starts the version present, without building it again', async () => {
  const pc = fakePc({ upstream: A });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), ['start a']);
  assert.equal(result.running, true);
  assert.equal(pc.written.status.outcome, 'up_to_date');
});

test('a dirty tree or no network: the present version, without fetching or building', async () => {
  const dirty = fakePc({ clean: false });
  await startImpera(dirty.deps);
  assert.deepEqual(dirty.actions(), ['start a']);
  assert.equal(dirty.written.status.tone, 'amber');
  const offline = fakePc({ online: false });
  await startImpera(offline.deps);
  assert.deepEqual(offline.actions(), ['start a']);
  assert.equal(offline.written.status.reason, 'offline');
});

test('an update without migration: fast-forward, install, build, start, healthy', async () => {
  const pc = fakePc({ files: { ...migrationsAt(A, ['0000_core']), ...migrationsAt(B, ['0000_core']) } });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), ['ff b', 'install', 'build b', 'stage', 'start b']);
  assert.equal(result.status.line, 'Mis à jour le 16 novembre 2026 à 08:12');
  assert.equal(pc.written.state.builtCommit, B);
  assert.equal(pc.written.state.migratedCommit, B);
});

test('new migrations: the backup first, then the migrations, then the start', async () => {
  const pc = fakePc({
    files: {
      ...migrationsAt(A, ['0000_core']),
      ...migrationsAt(B, ['0000_core', '0001_more', '0002_again'], {
        '0001_more': 'ALTER TABLE x ADD COLUMN y text;',
        '0002_again': 'CREATE INDEX i ON x (y);',
      }),
    },
  });
  await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), ['ff b', 'install', 'build b', 'stage', 'backup', 'migrate', 'start b']);
  // The journal names the migrations, never a value.
  assert.ok(pc.calls.includes('journal migration tag=0001_more'));
  assert.ok(pc.calls.includes('journal migration tag=0002_again'));
});

test('a failed backup stops the migrations and goes back to the previous version, retried next time', async () => {
  const pc = fakePc({
    fail: ['backup'],
    files: {
      ...migrationsAt(A, ['0000_core']),
      ...migrationsAt(B, ['0000_core', '0001_more'], { '0001_more': '' }),
    },
  });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), [
    'ff b',
    'install',
    'build b',
    'stage',
    'backup',
    'reset a',
    'install',
    'build a',
    'stage',
    'start a',
  ]);
  assert.equal(result.status.line, 'Mise à jour échouée, version précédente');
  assert.equal(pc.written.state.failedCommit, undefined);
  assert.equal(pc.written.state.migratedCommit, A);
});

test('a destructive migration is never run: the present version starts, with an alert', async () => {
  const pc = fakePc({
    files: {
      ...migrationsAt(A, ['0000_core']),
      ...migrationsAt(B, ['0000_core', '0001_drop'], { '0001_drop': 'ALTER TABLE x DROP COLUMN y;' }),
    },
  });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), ['start a']);
  assert.equal(result.status.reason, 'destructive');
  assert.ok(pc.calls.includes('journal refused_migration tag=0001_drop kinds=DROP_COLUMN'));
});

test('a destructive migration the owner allowed by name goes through', async () => {
  const pc = fakePc({
    allow: ['0001_drop'],
    files: {
      ...migrationsAt(A, ['0000_core']),
      ...migrationsAt(B, ['0000_core', '0001_drop'], { '0001_drop': 'DROP TABLE old_things;' }),
    },
  });
  await startImpera(pc.deps);
  assert.ok(pc.actions().includes('migrate'));
});

test('new migrations without a backup command: no update', async () => {
  const pc = fakePc({
    noBackup: true,
    files: {
      ...migrationsAt(A, ['0000_core']),
      ...migrationsAt(B, ['0000_core', '0001_more'], { '0001_more': '' }),
    },
  });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), ['start a']);
  assert.equal(result.status.reason, 'no_backup');
});

test('the new version unhealthy: back to the previous commit, rebuilt and restarted; B is not retried', async () => {
  const pc = fakePc({
    healthyAt: [A],
    files: { ...migrationsAt(A, ['0000_core']), ...migrationsAt(B, ['0000_core']) },
  });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), [
    'ff b',
    'install',
    'build b',
    'stage',
    'start b',
    'stop',
    'reset a',
    'install',
    'build a',
    'stage',
    'start a',
  ]);
  assert.equal(result.running, true);
  assert.equal(result.status.outcome, 'rolled_back');
  assert.equal(pc.written.state.failedCommit, B);
  assert.equal(pc.written.state.builtCommit, A);

  const next = fakePc({ state: pc.written.state });
  await startImpera(next.deps);
  assert.deepEqual(next.actions(), ['start a']);
  assert.equal(next.written.status.line, 'Mise à jour échouée, version précédente');
});

test('the previous version unhealthy too: the CRM stays stopped, red', async () => {
  const pc = fakePc({
    healthyAt: [],
    files: { ...migrationsAt(A, ['0000_core']), ...migrationsAt(B, ['0000_core']) },
  });
  const result = await startImpera(pc.deps);
  assert.equal(result.running, false);
  assert.equal(pc.actions().at(-1), 'stop');
  assert.deepEqual([result.status.outcome, result.status.tone], ['stopped', 'red']);
});

test('the migrations never go back on a rollback', async () => {
  const pc = fakePc({
    healthyAt: [A],
    files: {
      ...migrationsAt(A, ['0000_core']),
      ...migrationsAt(B, ['0000_core', '0001_more'], { '0001_more': '' }),
    },
  });
  await startImpera(pc.deps);
  assert.equal(pc.actions().filter((call) => call === 'migrate').length, 1);
  assert.equal(pc.written.state.migratedCommit, B);
});

test('a build of the new version that fails goes back to the previous one', async () => {
  const pc = fakePc({
    fail: ['build b'],
    files: { ...migrationsAt(A, ['0000_core']), ...migrationsAt(B, ['0000_core']) },
  });
  const result = await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), [
    'ff b',
    'install',
    'build b',
    'reset a',
    'install',
    'build a',
    'stage',
    'start a',
  ]);
  assert.equal(result.status.outcome, 'rolled_back');
});

test('a commit present but never built (first start, or code fetched by hand) is built before it starts', async () => {
  const pc = fakePc({
    upstream: A,
    state: {},
    files: migrationsAt(A, ['0000_core']),
  });
  await startImpera(pc.deps);
  assert.deepEqual(pc.actions(), ['install', 'build a', 'stage', 'start a']);
  assert.equal(pc.written.state.builtCommit, A);
  assert.equal(pc.written.state.migratedCommit, A);
});
