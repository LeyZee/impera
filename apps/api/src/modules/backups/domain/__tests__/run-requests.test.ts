import { describe, expect, it } from 'vitest';

import { BackupRunInProgress, decideRequest, type StoredBackupRequest } from '../run-requests';
import type { BackupRun } from '../status';

const NOW = new Date('2026-10-29T10:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

const request = (id: string, pickedAt: Date | null = null): StoredBackupRequest => ({
  id,
  requestedAt: hoursAgo(0.01),
  requestedByUserId: 'owner',
  pickedAt,
});
const run = (status: BackupRun['status'], startedHoursAgo: number): BackupRun => ({
  status,
  startedAt: hoursAgo(startedHoursAgo),
  finishedAt: status === 'running' ? null : hoursAgo(startedHoursAgo - 0.1),
  sizeBytes: null,
  error: status === 'failed' ? 'failed at step upload' : null,
});

describe('a request to export now (REG-24)', () => {
  it('records a new request after a failed night, or with no export at all', () => {
    expect(decideRequest({ sameId: null, pending: null, latestRun: run('failed', 7) }, NOW)).toEqual({
      kind: 'insert',
    });
    expect(decideRequest({ sameId: null, pending: null, latestRun: null }, NOW)).toEqual({ kind: 'insert' });
  });

  it('gives back the same request sent twice, and the one already waiting to a second one', () => {
    const sent = request('a', hoursAgo(0));
    expect(decideRequest({ sameId: sent, pending: null, latestRun: run('running', 0) }, NOW)).toEqual({
      kind: 'existing',
      request: sent,
    });
    const waiting = request('b');
    expect(decideRequest({ sameId: null, pending: waiting, latestRun: null }, NOW)).toEqual({
      kind: 'existing',
      request: waiting,
    });
  });

  it('refuses while an export runs, but not past 26 hours of a run that crashed', () => {
    expect(() => decideRequest({ sameId: null, pending: null, latestRun: run('running', 0.2) }, NOW)).toThrow(
      BackupRunInProgress,
    );
    expect(decideRequest({ sameId: null, pending: null, latestRun: run('running', 27) }, NOW)).toEqual({
      kind: 'insert',
    });
  });
});
