import type { LinkServiceFailure } from '@impera/contracts';

import { LinkServiceError, type LinkServiceKeyStore } from '../domain/link-service';
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
  /** Why the service refused or failed, null when it answered: what was read before is kept, the rest waits. */
  readonly failure: LinkServiceFailure | null;
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
  let failure: LinkServiceFailure | null = null;
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
      if (!(error instanceof LinkServiceError)) throw error;
      failure = error.kind;
      retryAfterSeconds = error.retryAfterSeconds;
      if (error.kind !== 'unexpected') break;
    }
  }
  return { links: read, hours, deferred: links.length - read, calls, failure, retryAfterSeconds };
}

/** The calls one pass may make: under the service's limit of a minute, and far under its limit of a day. */
const CALLS_PER_PASS = 90;

export interface LinkHoursPass {
  /** `off`: no address or no key that opens. `stopped`: the service refused, limited or failed, the rest waits. */
  readonly outcome: 'off' | 'done' | 'stopped';
  readonly creators: number;
  readonly links: number;
  readonly hours: number;
  readonly deferred: number;
  readonly calls: number;
  /** The creators whose reading failed on our side: they did not stop the others. */
  readonly failedCreators: number;
}

interface PassLogger {
  info(fields: object, message: string): void;
  warn(fields: object, message: string): void;
}

/**
 * The `connector.read_link_hours` job (ADR 0120 § 3), hourly. The key is read once for the pass; each creator is
 * then read in turn, with her own references read in her own transaction, within what is left of the pass's calls.
 * The turn starts one creator further each hour, so that a pass cut short by its calls does not always leave the
 * same ones out. A creator whose reading fails on our side does not stop the others; the service refusing, limiting
 * or failing stops the pass, and the next hour is the retry. Neither the key, the address nor a link's name is logged.
 */
export function createReadLinkHoursJob(deps: {
  readonly keys: Pick<LinkServiceKeyStore, 'find'> | null;
  readonly readerOf: ((key: string) => Pick<LinkStatsConnector, 'readHours' | 'readRobotHours'>) | null;
  readonly store: LinkHourStore;
  readonly now: () => Date;
}): (logger: PassLogger) => Promise<LinkHoursPass> {
  return async (logger) => {
    const pass = { creators: 0, links: 0, hours: 0, deferred: 0, calls: 0, failedCreators: 0 };
    if (deps.keys === null || deps.readerOf === null) return { outcome: 'off', ...pass };
    const key = (await deps.keys.find())?.key ?? null;
    if (key === null) return { outcome: 'off', ...pass };
    const stats = deps.readerOf(key);
    const now = deps.now();
    const creators = await deps.store.creatorsToRead();
    const first = creators.length === 0 ? 0 : Math.floor(now.getTime() / 3_600_000) % creators.length;
    const turn = [...creators.slice(first), ...creators.slice(0, first)];
    let outcome: LinkHoursPass['outcome'] = 'done';
    for (const creatorId of turn) {
      try {
        const run = await readLinkHours(
          { stats, store: deps.store },
          { creatorId, now, callsLeft: CALLS_PER_PASS - pass.calls },
        );
        pass.creators += 1;
        pass.links += run.links;
        pass.hours += run.hours;
        pass.deferred += run.deferred;
        pass.calls += run.calls;
        if (run.failure !== null && run.failure !== 'unexpected') {
          logger.warn(
            { failure: run.failure, retryAfterSeconds: run.retryAfterSeconds },
            'link hours: the redirect service stopped the pass',
          );
          outcome = 'stopped';
          break;
        }
      } catch {
        // Hers alone: the others are still read. The error may carry a row, so only the fact is logged.
        pass.failedCreators += 1;
        logger.warn({ creatorId }, 'link hours: a creator could not be read');
      }
    }
    logger.info({ outcome, ...pass }, 'link hours read');
    return { outcome, ...pass };
  };
}
