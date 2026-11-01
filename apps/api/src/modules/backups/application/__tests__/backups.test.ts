import { describe, expect, it } from 'vitest';

import type {
  BackupOverduePayload,
  BackupRequestsStore,
  BackupRunsReader,
  RestoreTestsStore,
} from '../../domain/ports';
import type { StoredRestoreTest } from '../../domain/restore-tests';
import { BackupRunInProgress, decideRequest, type StoredBackupRequest } from '../../domain/run-requests';
import type { BackupRun } from '../../domain/status';
import {
  checkBackups,
  readBackupStatus,
  recordRestoreTest,
  requestBackupRun,
  restoreTestFresh,
} from '../backups';

const now = new Date('2026-10-27T12:00:00Z');
const clock = { now: () => now };

function reader(
  lastSucceededAt: Date | null,
  latestRun: BackupRun | null = null,
  firstRunStartedAt: Date | null = lastSucceededAt,
): BackupRunsReader {
  return {
    lastSucceededAt: () => Promise.resolve(lastSucceededAt),
    latestRun: () => Promise.resolve(latestRun),
    firstRunStartedAt: () => Promise.resolve(firstRunStartedAt),
  };
}

/** The store in memory, for the application's tests: one succeeded export per fingerprint given. */
function memoryRestoreTests(
  backups: readonly { readonly id: string; readonly sha256: string; readonly finishedAt: Date }[] = [],
): RestoreTestsStore & { readonly tests: StoredRestoreTest[]; readonly audit: string[] } {
  const tests: StoredRestoreTest[] = [];
  const audit: string[] = [];
  return {
    tests,
    audit,
    findSucceededBackup(sha256) {
      const backup = backups.find((candidate) => candidate.sha256 === sha256);
      return Promise.resolve(backup === undefined ? null : { id: backup.id, finishedAt: backup.finishedAt });
    },
    record(entry) {
      const existing = tests.find((test) => test.id === entry.id);
      if (existing !== undefined) return Promise.resolve({ inserted: false, test: existing });
      const backup = backups.find((candidate) => candidate.id === entry.backupRunId);
      const test = {
        ...entry,
        backupSha256: backup?.sha256 ?? '',
        backupFinishedAt: backup?.finishedAt ?? new Date(0),
        createdAt: new Date(),
      };
      tests.push(test);
      audit.push(entry.id);
      return Promise.resolve({ inserted: true, test });
    },
    latest() {
      const sorted = [...tests].sort((a, b) => b.testedAt.getTime() - a.testedAt.getTime());
      return Promise.resolve(sorted[0] ?? null);
    },
  };
}

/** `backup_requests` in memory: the decision of the domain, as the Postgres store applies it under its lock. */
function memoryRequests(latestRun: BackupRun | null = null): BackupRequestsStore & {
  readonly rows: StoredBackupRequest[];
} {
  const rows: StoredBackupRequest[] = [];
  return {
    rows,
    request(entry, _actor, decide) {
      const decision = decide({
        sameId: rows.find((row) => row.id === entry.id) ?? null,
        pending: rows.find((row) => row.pickedAt === null) ?? null,
        latestRun,
      });
      if (decision.kind === 'existing') return Promise.resolve({ created: false, request: decision.request });
      const request = { ...entry, requestedAt: now, pickedAt: null };
      rows.push(request);
      return Promise.resolve({ created: true, request });
    },
    pending: () => Promise.resolve(rows.find((row) => row.pickedAt === null) ?? null),
  };
}

function alerts() {
  const published: BackupOverduePayload[] = [];
  const days = new Set<string>();
  return {
    published,
    publishOverdue(payload: BackupOverduePayload) {
      if (days.has(payload.day)) return Promise.resolve(false);
      days.add(payload.day);
      published.push(payload);
      return Promise.resolve(true);
    },
  };
}

describe('backups', () => {
  it('gives the owner the state, the last success and the latest run, failed included', async () => {
    const failed: BackupRun = {
      status: 'failed',
      startedAt: new Date('2026-10-27T01:00:00Z'),
      finishedAt: new Date('2026-10-27T01:00:05Z'),
      sizeBytes: null,
      error: 'failed at step upload',
    };
    expect(
      await readBackupStatus({
        runs: reader(new Date('2026-10-26T12:10:00Z'), failed),
        restoreTests: memoryRestoreTests(),
        requests: memoryRequests(),
        clock,
      }),
    ).toEqual({
      state: 'ok',
      lastSucceededAt: '2026-10-26T12:10:00.000Z',
      overdueAfterHours: 26,
      lastRun: {
        status: 'failed',
        startedAt: '2026-10-27T01:00:00.000Z',
        finishedAt: '2026-10-27T01:00:05.000Z',
        sizeBytes: null,
        error: 'failed at step upload',
      },
      lastRestoreTest: null,
      restoreTestFresh: false,
    });
    expect(
      await readBackupStatus({
        runs: reader(null),
        restoreTests: memoryRestoreTests(),
        requests: memoryRequests(),
        clock,
      }),
    ).toMatchObject({
      state: 'never',
      lastRun: null,
    });
  });

  it('alerts once per Paris day while the export is overdue', async () => {
    const sink = alerts();
    const last = new Date('2026-10-26T01:00:00Z');
    const deps = { runs: reader(last), alerts: sink, clock };
    expect(await checkBackups(deps)).toBe('alerted');
    expect(await checkBackups(deps)).toBe('already_alerted');
    expect(sink.published).toEqual([{ lastSucceededAt: last, day: '2026-10-27' }]);
  });

  it('stays quiet when an export succeeded in time, or when the service never ran or just started', async () => {
    const sink = alerts();
    expect(await checkBackups({ runs: reader(new Date('2026-10-27T01:00:00Z')), alerts: sink, clock })).toBe(
      'ok',
    );
    expect(await checkBackups({ runs: reader(null), alerts: sink, clock })).toBe('ok');
    const justDeployed = reader(null, null, new Date('2026-10-27T09:00:00Z'));
    expect(await checkBackups({ runs: justDeployed, alerts: sink, clock })).toBe('ok');
    expect(sink.published).toEqual([]);
    const tryingForTwoDays = reader(null, null, new Date('2026-10-25T09:00:00Z'));
    expect(await checkBackups({ runs: tryingForTwoDays, alerts: sink, clock })).toBe('alerted');
    expect(sink.published).toEqual([{ lastSucceededAt: null, day: '2026-10-27' }]);
  });
});

describe('restore tests (ADR 0028 § 6)', () => {
  const backup = {
    id: '0195f0c0-0000-7000-8000-000000000001',
    sha256: 'a'.repeat(64),
    finishedAt: new Date('2026-10-20T01:10:00Z'),
  };
  const owner = { userId: 'owner-1', ip: '192.0.2.1' };
  const body = {
    id: '0195f0c0-0000-7000-8000-0000000000aa',
    backupSha256: 'a'.repeat(64),
    testedAt: '2026-10-25T14:00:00.000Z',
    durationSeconds: 1_260,
    rowCountMismatches: 0,
    notes: null,
  };

  it('records a test matched to its export, once, and gives the same test back on a replay', async () => {
    const store = memoryRestoreTests([backup]);
    const first = await recordRestoreTest({ restoreTests: store, clock }, body, owner);
    expect(first).toMatchObject({ created: true, test: { id: body.id, backupSha256: 'a'.repeat(64) } });
    const again = await recordRestoreTest({ restoreTests: store, clock }, body, owner);
    expect(again.created).toBe(false);
    expect(store.tests).toHaveLength(1);
    expect(store.audit).toEqual([body.id]);
  });

  it('refuses the same id with other values', async () => {
    const store = memoryRestoreTests([backup]);
    await recordRestoreTest({ restoreTests: store, clock }, body, owner);
    await expect(
      recordRestoreTest({ restoreTests: store, clock }, { ...body, rowCountMismatches: 2 }, owner),
    ).rejects.toMatchObject({ code: 'restore_test_conflict' });
  });

  it('refuses an unknown fingerprint, a test before its export, and one in the future', async () => {
    const deps = { restoreTests: memoryRestoreTests([backup]), clock };
    await expect(
      recordRestoreTest(deps, { ...body, backupSha256: 'b'.repeat(64) }, owner),
    ).rejects.toMatchObject({
      code: 'restore_test_backup_unprocessable',
    });
    await expect(
      recordRestoreTest(deps, { ...body, testedAt: '2026-10-20T01:00:00.000Z' }, owner),
    ).rejects.toMatchObject({ code: 'restore_test_before_backup_unprocessable' });
    await expect(
      recordRestoreTest(deps, { ...body, testedAt: '2026-10-27T12:06:00.000Z' }, owner),
    ).rejects.toMatchObject({ code: 'restore_test_in_future_unprocessable' });
    // Four minutes ahead: a client clock a little fast is no future.
    expect(
      (await recordRestoreTest(deps, { ...body, testedAt: '2026-10-27T12:04:00.000Z' }, owner)).created,
    ).toBe(true);
  });

  it('reads freshness on the latest test only', async () => {
    const store: RestoreTestsStore & { tests: StoredRestoreTest[] } = memoryRestoreTests([backup]);
    expect(await restoreTestFresh({ restoreTests: store }, now)).toBe(false);
    await recordRestoreTest({ restoreTests: store, clock }, body, owner);
    expect(await restoreTestFresh({ restoreTests: store }, now)).toBe(true);
    // A later test that found mismatches: the restore is broken now, whatever the earlier one said.
    await recordRestoreTest(
      { restoreTests: store, clock },
      {
        ...body,
        id: '0195f0c0-0000-7000-8000-0000000000bb',
        testedAt: '2026-10-26T14:00:00.000Z',
        rowCountMismatches: 3,
      },
      owner,
    );
    expect(await restoreTestFresh({ restoreTests: store }, now)).toBe(false);
  });

  it('records a request to export now once, says it waits, and refuses one while an export runs (REG-24)', async () => {
    const requests = memoryRequests();
    const actor = { userId: 'owner', ip: null };
    const id = '0192f3a0-0000-7000-8000-0000000000b1';
    const first = await requestBackupRun({ requests, clock }, id, actor);
    expect(first).toEqual({
      created: true,
      request: { id, requestedAt: now.toISOString(), pickedAt: null },
    });
    // Sent again, or a second click with another id: the request already waiting, no second row.
    expect(await requestBackupRun({ requests, clock }, id, actor)).toEqual({ ...first, created: false });
    expect(
      await requestBackupRun({ requests, clock }, '0192f3a0-0000-7000-8000-0000000000b2', actor),
    ).toEqual({ ...first, created: false });
    expect(requests.rows).toHaveLength(1);
    expect(
      await readBackupStatus({ runs: reader(null), restoreTests: memoryRestoreTests(), requests, clock }),
    ).toMatchObject({ runRequestedAt: now.toISOString() });

    const running: BackupRun = {
      status: 'running',
      startedAt: new Date(now.getTime() - 60_000),
      finishedAt: null,
      sizeBytes: null,
      error: null,
    };
    await expect(requestBackupRun({ requests: memoryRequests(running), clock }, id, actor)).rejects.toThrow(
      BackupRunInProgress,
    );
    expect(decideRequest({ sameId: null, pending: null, latestRun: null }, now)).toEqual({ kind: 'insert' });
  });
});
