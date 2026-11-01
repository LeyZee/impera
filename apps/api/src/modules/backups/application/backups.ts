import type {
  BackupRunRequest,
  BackupStatus,
  RecordRestoreTestBodySchema,
  RestoreTest,
} from '@nirvana/contracts';
import type { z } from 'zod';

import type {
  BackupAlerts,
  BackupRequestsStore,
  BackupRunsReader,
  Clock,
  RestoreTestActor,
  RestoreTestsStore,
} from '../domain/ports';
import {
  checkTestedAt,
  isRestoreTestFresh,
  isSameTest,
  RestoreTestBackupUnknown,
  RestoreTestConflict,
  type RestoreTestEntry,
  type StoredRestoreTest,
} from '../domain/restore-tests';
import { decideRequest, type StoredBackupRequest } from '../domain/run-requests';
import { BACKUP_OVERDUE_HOURS, backupDay, backupState, needsAlert } from '../domain/status';

export interface BackupsDeps {
  readonly runs: BackupRunsReader;
  readonly alerts: BackupAlerts;
  readonly restoreTests: RestoreTestsStore;
  readonly requests: BackupRequestsStore;
  readonly clock: Clock;
}

/** `GET /v1/backups/status`: where the daily export stands, for the owner's Dashboard. */
export async function readBackupStatus(
  deps: Pick<BackupsDeps, 'runs' | 'restoreTests' | 'requests' | 'clock'>,
): Promise<BackupStatus> {
  const [lastSucceededAt, lastRun, lastTest, pending] = await Promise.all([
    deps.runs.lastSucceededAt(),
    deps.runs.latestRun(),
    deps.restoreTests.latest(),
    deps.requests.pending(),
  ]);
  const now = deps.clock.now();
  return {
    state: backupState(lastSucceededAt, now),
    lastSucceededAt: lastSucceededAt?.toISOString() ?? null,
    overdueAfterHours: BACKUP_OVERDUE_HOURS,
    lastRun:
      lastRun === null
        ? null
        : {
            status: lastRun.status,
            startedAt: lastRun.startedAt.toISOString(),
            finishedAt: lastRun.finishedAt?.toISOString() ?? null,
            sizeBytes: lastRun.sizeBytes,
            error: lastRun.error,
          },
    lastRestoreTest:
      lastTest === null
        ? null
        : {
            testedAt: lastTest.testedAt.toISOString(),
            backupFinishedAt: lastTest.backupFinishedAt.toISOString(),
            durationSeconds: lastTest.durationSeconds,
            rowCountMismatches: lastTest.rowCountMismatches,
          },
    restoreTestFresh: isRestoreTestFresh(lastTest, now),
    ...(pending !== null && { runRequestedAt: pending.requestedAt.toISOString() }),
  };
}

const toRunRequest = (request: StoredBackupRequest): BackupRunRequest => ({
  id: request.id,
  requestedAt: request.requestedAt.toISOString(),
  pickedAt: request.pickedAt?.toISOString() ?? null,
});

/**
 * `POST /v1/backups/runs` (REG-24): the owner asks for an export now. Recorded for the `backup` service, which runs
 * the same export as each night (ADR 0028 § 1): one at a time, the same `id` twice is one request.
 */
export async function requestBackupRun(
  deps: Pick<BackupsDeps, 'requests' | 'clock'>,
  id: string,
  actor: RestoreTestActor,
): Promise<{ readonly created: boolean; readonly request: BackupRunRequest }> {
  const { created, request } = await deps.requests.request(
    { id, requestedByUserId: actor.userId },
    actor,
    (context) => decideRequest(context, deps.clock.now()),
  );
  return { created, request: toRunRequest(request) };
}

/** EQ-17's pay guard, through the composition root: is the restore proven for an action made now, at `at`? */
export async function restoreTestFresh(deps: Pick<BackupsDeps, 'restoreTests'>, at: Date): Promise<boolean> {
  return isRestoreTestFresh(await deps.restoreTests.latest(), at);
}

function toRestoreTest(test: StoredRestoreTest): RestoreTest {
  return {
    id: test.id,
    backupSha256: test.backupSha256,
    testedAt: test.testedAt.toISOString(),
    durationSeconds: test.durationSeconds,
    rowCountMismatches: test.rowCountMismatches,
    notes: test.notes,
    createdAt: test.createdAt.toISOString(),
  };
}

/**
 * `POST /v1/backups/restore-tests` (ADR 0028 § 6): the test must name an export that succeeded, be dated after it
 * ended and not in the future. The same `id` sent again with the same values gives back the recorded test; with
 * other values, a conflict.
 */
export async function recordRestoreTest(
  deps: Pick<BackupsDeps, 'restoreTests' | 'clock'>,
  body: z.output<typeof RecordRestoreTestBodySchema>,
  actor: RestoreTestActor,
): Promise<{ readonly created: boolean; readonly test: RestoreTest }> {
  const backup = await deps.restoreTests.findSucceededBackup(body.backupSha256);
  if (backup === null) throw new RestoreTestBackupUnknown();
  const testedAt = new Date(body.testedAt);
  const refused = checkTestedAt(testedAt, backup.finishedAt, deps.clock.now());
  if (refused !== null) throw refused;
  const entry: RestoreTestEntry = {
    id: body.id,
    backupRunId: backup.id,
    testedAt,
    durationSeconds: body.durationSeconds,
    rowCountMismatches: body.rowCountMismatches,
    notes: body.notes,
    enteredByUserId: actor.userId,
  };
  const { inserted, test } = await deps.restoreTests.record(entry, actor);
  if (!inserted && !isSameTest(test, entry)) throw new RestoreTestConflict();
  return { created: inserted, test: toRestoreTest(test) };
}

export type BackupCheck = 'ok' | 'alerted' | 'already_alerted';

/**
 * The hourly check (`backups.check`): an export missing for 26 hours publishes `backup_overdue`, at most once per
 * Paris day while it lasts, so the alert comes back each morning until an export succeeds.
 */
export async function checkBackups(
  deps: Pick<BackupsDeps, 'runs' | 'alerts' | 'clock'>,
): Promise<BackupCheck> {
  const now = deps.clock.now();
  const [lastSucceededAt, firstRunStartedAt] = await Promise.all([
    deps.runs.lastSucceededAt(),
    deps.runs.firstRunStartedAt(),
  ]);
  if (!needsAlert(backupState(lastSucceededAt, now), firstRunStartedAt, now)) return 'ok';
  const published = await deps.alerts.publishOverdue({ lastSucceededAt, day: backupDay(now) });
  return published ? 'alerted' : 'already_alerted';
}
