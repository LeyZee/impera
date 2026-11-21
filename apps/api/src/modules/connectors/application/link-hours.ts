import { LinkServiceError } from '../domain/link-service';
import {
  CALLS_PER_LINK,
  hoursOfWindow,
  hoursWithoutRobots,
  readingWindow,
  type LinkHourStore,
  type LinkStatsConnector,
} from '../domain/link-stats';

export interface LinkHoursRun {
  /** Her links read by this run. */
  readonly links: number;
  /** The hours written: new ones, and open ones replaced. */
  readonly hours: number;
  /** Her links left for a later run: the calls allowed ran out, or the service failed. */
  readonly deferred: number;
  /** The calls made to the service, whether they answered or not. */
  readonly calls: number;
  /** The service refused or failed: what was read before is kept, the rest waits. */
  readonly failed: boolean;
  /** The seconds the service asked to wait, when it said so. */
  readonly retryAfterSeconds: number | null;
}

/**
 * One run of the hourly reading of a creator's redirect links (ADR 0120 § 3): for each link of hers the owner
 * attached, the hours of the window, robots removed, kept one row an hour. A link whose reading fails writes nothing
 * and removes nothing: its hours wait for the next run. Replayed, it writes the same rows.
 *
 * `callsLeft` is what the run may still spend at the service; a link is read whole or not at all.
 */
export async function readLinkHours(
  deps: {
    readonly stats: Pick<LinkStatsConnector, 'readHours' | 'readRobotHours'>;
    readonly store: LinkHourStore;
  },
  input: { readonly creatorId: string; readonly now: Date; readonly callsLeft: number },
): Promise<LinkHoursRun> {
  const { creatorId, now } = input;
  const range = readingWindow(now);
  const links = await deps.store.attachedLinks(creatorId);
  let read = 0;
  let hours = 0;
  let calls = 0;
  let failed = false;
  let retryAfterSeconds: number | null = null;
  for (const link of links) {
    if (input.callsLeft - calls < CALLS_PER_LINK) break;
    try {
      // Counted before they are made: a call that fails was still spent.
      calls += CALLS_PER_LINK - 1;
      const readings = await deps.stats.readHours(link.ref, range);
      calls += 1;
      const robots = await deps.stats.readRobotHours(link.ref, range);
      const kept = hoursOfWindow(hoursWithoutRobots(readings, robots), range, now);
      hours += await deps.store.record(creatorId, link.id, kept, now);
      read += 1;
    } catch (error) {
      // Whatever it was, the service is not asked again in this run for her: the next one starts over.
      failed = true;
      if (error instanceof LinkServiceError) retryAfterSeconds = error.retryAfterSeconds;
      break;
    }
  }
  return { links: read, hours, deferred: links.length - read, calls, failed, retryAfterSeconds };
}
