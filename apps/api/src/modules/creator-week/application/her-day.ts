import type { HerDay } from '@impera/contracts';

import { addDays, wallClockToInstant } from '../../scheduling/pure';
import { DAY_DEFAULTS, dayLines } from '../domain/day';
import type { DayTickStore, VideoCover, WeekFactsReader } from '../domain/ports';

export interface HerDayDeps {
  readonly days: Pick<DayTickStore, 'read'>;
  readonly facts: Pick<WeekFactsReader, 'videos'>;
}

/**
 * The feed's videos her coffre has for `day` (ADR 0140, avenant du 27/11): one arrived that day, or, for today, one
 * waiting in her coffre. The one reading of her video of the day, for her and for her team.
 */
export const videosFor = (day: string, today: string, cover: VideoCover): number =>
  Math.max(cover.byDay.get(day) ?? 0, day === today ? cover.inStock : 0);

/** Her day as she reads it (ADR 0140, second avenant): the code's rhythm, what she ticked, what her coffre holds. */
export async function herDay(
  deps: HerDayDeps,
  userId: string,
  day: string | null,
  now: Date,
): Promise<HerDay> {
  const read = await deps.days.read(userId, day, now);
  const window = {
    from: wallClockToInstant(read.day, 0, read.timeZone),
    to: wallClockToInstant(addDays(read.day, 1), 0, read.timeZone),
  };
  const cover = await deps.facts.videos(userId, window, read.timeZone);
  return {
    day: read.day,
    today: read.today,
    lines: dayLines(DAY_DEFAULTS, { ticked: read.done, videos: videosFor(read.day, read.today, cover) }),
  };
}
