import type { BackupRunStatus, BackupState } from '@nirvana/contracts';

/**
 * When the daily export counts as missing (ADR 0028 § 5). The export runs at 3 h, Paris time: 26 hours leave one
 * slow or retried run its margin, and turn a missed night into an alert the next morning.
 */
export const BACKUP_OVERDUE_HOURS = 26;

/** The time zone of the export's schedule, and of the day an alert counts once in. */
const BACKUP_TIME_ZONE = 'Europe/Paris';

const HOUR_MS = 3_600_000;

/** A row of `backup_runs`, as the module reads it. */
export interface BackupRun {
  readonly status: BackupRunStatus;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly sizeBytes: number | null;
  readonly error: string | null;
}

const olderThanOverdue = (at: Date, now: Date): boolean =>
  now.getTime() - at.getTime() > BACKUP_OVERDUE_HOURS * HOUR_MS;

/**
 * `ok`: the last success is 26 hours old at most. `overdue`: it is older. `never`: no export ever succeeded. Only
 * `succeeded` rows count: a run still `running` after 26 hours is no success.
 */
export function backupState(lastSucceededAt: Date | null, now: Date): BackupState {
  if (lastSucceededAt === null) return 'never';
  return olderThanOverdue(lastSucceededAt, now) ? 'overdue' : 'ok';
}

/**
 * Whether the state calls for the Telegram alert, given when the first run of the service started (`null`: no row
 * at all). `overdue` always does. `never` does once the service has been trying for 26 hours: right after a
 * deployment, before the first night, no success yet is no news. No row at all means the service never ran (a
 * development database, or a deployment without it): the Dashboard shows it in amber, Telegram says nothing.
 */
export function needsAlert(state: BackupState, firstRunStartedAt: Date | null, now: Date): boolean {
  if (state === 'overdue') return true;
  if (state === 'ok' || firstRunStartedAt === null) return false;
  return olderThanOverdue(firstRunStartedAt, now);
}

/** `2026-10-27`: the day `at` falls on in Paris. */
export function backupDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BACKUP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
