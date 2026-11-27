import type { HerDay } from '@impera/contracts';

import { DAY_DEFAULTS, dayLines } from '../domain/day';
import type { DayTickStore } from '../domain/ports';

/** Her day as she reads it (ADR 0140, second avenant): the code's rhythm, what she ticked. */
export async function herDay(
  store: DayTickStore,
  userId: string,
  day: string | null,
  now: Date,
): Promise<HerDay> {
  const read = await store.read(userId, day, now);
  return { day: read.day, today: read.today, lines: dayLines(DAY_DEFAULTS, read.done) };
}
