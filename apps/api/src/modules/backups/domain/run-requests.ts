import { DomainError } from '@nirvana/contracts';

import { BACKUP_OVERDUE_HOURS, type BackupRun } from './status';

/** A request to export now (REG-24), as `backup_requests` keeps it. */
export interface StoredBackupRequest {
  readonly id: string;
  readonly requestedAt: Date;
  readonly requestedByUserId: string;
  /** When the `backup` service started the export; null while the request waits. */
  readonly pickedAt: Date | null;
}

/** What stands when the owner asks, read under one lock. */
export interface RequestContext {
  /** The request with this `id`, when it was already made. */
  readonly sameId: StoredBackupRequest | null;
  /** The oldest request the `backup` service has not picked up yet. */
  readonly pending: StoredBackupRequest | null;
  /** The latest export started, whatever its outcome. */
  readonly latestRun: BackupRun | null;
}

export type RequestDecision =
  { readonly kind: 'insert' } | { readonly kind: 'existing'; readonly request: StoredBackupRequest };

export class BackupRunInProgress extends DomainError {
  constructor() {
    super('backup_run_in_progress_conflict', 'Une sauvegarde est déjà en cours');
  }
}

const HOUR_MS = 3_600_000;

/**
 * One export at a time, never two requests waiting (REG-24). The same `id` again gives back its request (a retry after
 * a lost answer); a request already waiting is the answer to a second one; an export running now, started less than
 * 26 hours ago, refuses a new one (its outcome will show). A `running` row older than that is a crash, not an export:
 * asking again is the way out of it.
 */
export function decideRequest(context: RequestContext, now: Date): RequestDecision {
  if (context.sameId !== null) return { kind: 'existing', request: context.sameId };
  if (context.pending !== null) return { kind: 'existing', request: context.pending };
  const run = context.latestRun;
  if (
    run !== null &&
    run.status === 'running' &&
    now.getTime() - run.startedAt.getTime() < BACKUP_OVERDUE_HOURS * HOUR_MS
  ) {
    throw new BackupRunInProgress();
  }
  return { kind: 'insert' };
}
