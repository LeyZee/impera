import {
  calendarDayAt,
  SCRIPT_STATS_MIN_FANS,
  type CreatorId,
  type Platform,
  type ScriptPerformanceDays,
  type ScriptPerformanceList,
} from '@impera/contracts';

import { rankPerformances, scriptPerformanceOf } from '../domain/performance';
import type { PlatformScriptReadStore, RunsSince } from '../domain/ports';

import type { PlatformScriptsReader } from './platform-script-reads';

interface Deps {
  readonly store: PlatformScriptReadStore;
  /** The platform's calendar: the days Reveal's readings are kept by (`salesFeedTimeZone`). */
  readonly dayZone: (platform: Platform) => string | null;
  readonly runsSince: RunsSince;
}

const DAY_MS = 86_400_000;

/** The days read before the period: the last reading before it is the base its counts start from. */
const BASE_DAYS = 7;

/**
 * The performance of her active scripts over the last `days` (ADR 0129, sous-lot 4c): the owner and the active managers
 * of her list only (§ 17); `null` for anyone else, as for a creator who does not exist. The runs started in the period
 * are counted; Reveal's counts cover its calendar days from the period's first to today.
 */
export async function creatorScriptPerformance(
  deps: Deps,
  reader: PlatformScriptsReader,
  creatorId: CreatorId,
  days: ScriptPerformanceDays,
  now: Date,
): Promise<ScriptPerformanceList | null> {
  if (reader.role !== 'owner' && reader.role !== 'operator') return null;
  const since = new Date(now.getTime() - days * DAY_MS);
  const zone = deps.dayZone('reveal') ?? 'UTC';
  const fromDay = calendarDayAt(new Date(since.getTime() - BASE_DAYS * DAY_MS), zone);
  const input = await deps.store.performanceOf(creatorId, reader.userId, fromDay);
  if (input === null) return null;
  const runs = await deps.runsSince(creatorId, reader.userId, since);
  if (runs === null) return null;
  const period = { from: calendarDayAt(since, zone), to: calendarDayAt(now, zone) };
  const lines = input.scripts.map((script) =>
    scriptPerformanceOf(
      script,
      runs.filter((run) => run.scriptRef === script.ref),
      input.readings,
      period,
      SCRIPT_STATS_MIN_FANS,
    ),
  );
  return {
    days,
    since: since.toISOString(),
    minFans: SCRIPT_STATS_MIN_FANS,
    scripts: rankPerformances(lines),
  };
}
