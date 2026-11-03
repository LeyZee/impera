import type { ConnectionService, Platform } from '@impera/contracts';

/**
 * When the sales register of a platform is told down for want of an answer (Telegram P3-12): after several failed
 * reads in a row over a quarter of an hour, so that one slow minute never rings. A refused key is down at once, a 429
 * is a pause (`pausedUntil`), never an outage.
 */
const OUTAGE_AFTER_READS = 3;
export const OUTAGE_AFTER_MS = 15 * 60_000;

/** The failed reads in a row since the first one; forgotten at the first answer. */
export interface UnreachableRun {
  readonly since: Date;
  readonly reads: number;
}

export function nextUnreachableRun(run: UnreachableRun | null, now: Date): UnreachableRun {
  return run === null ? { since: now, reads: 1 } : { since: run.since, reads: run.reads + 1 };
}

export function isLastingOutage(run: UnreachableRun, now: Date): boolean {
  return run.reads >= OUTAGE_AFTER_READS && now.getTime() - run.since.getTime() >= OUTAGE_AFTER_MS;
}

/** The service an outage alert names: Reveal's CRM API; the other platforms have no sales feed. */
export function connectionServiceOf(platform: Platform): ConnectionService | null {
  return platform === 'reveal' ? 'reveal_crm' : null;
}
