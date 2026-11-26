import { and, eq, schema, sql, withAdmin, type Database } from '@impera/db';

import { addDays, calendarDayIn, wallClockToInstant } from '../../../scheduling/pure';
import { availabilityWindows, type Interval } from '../../domain/availability';
import { firstPlacement } from '../../domain/placement';

import { availabilityOf } from './rows';

const tasks = schema.creatorTasks;
const availabilities = schema.creatorAvailabilities;

/** How far ahead a cam looks for room in her dispos cam: two weeks, as a shoot does. */
const CAM_HORIZON_DAYS = 14;

/**
 * The first room of `minutes` in her dispos cam from `from` (ADR 0159 § 5): wholly inside a dispo she opened to a
 * fan's cam, over none of her timed tasks nor of `busy` (the cams already booked, her absence), on the quarter hour.
 * Null when none has room in two weeks. `after`, one of her days, closes everything up to its end: the last day of an
 * absence. On the owner's connection in one door, bounded to her by `creator_id` in every query: her dispos and tasks
 * have no policy for the server's own reads, and the caller has already decided it may read her.
 */
export function createCamRoomReader(adminDb: Database): (
  creatorId: string,
  ask: {
    readonly minutes: number;
    readonly from: Date;
    readonly busy: readonly Interval[];
    readonly after: string | null;
  },
) => Promise<Interval | null> {
  return (creatorId, { minutes, busy, after, from: asked }) =>
    withAdmin(adminDb, async (tx) => {
      const [creator] = await tx
        .select({ timeZone: schema.creators.timezone })
        .from(schema.creators)
        .where(eq(schema.creators.id, creatorId));
      if (creator === undefined) return null;
      const reopens = after === null ? null : wallClockToInstant(addDays(after, 1), 0, creator.timeZone);
      const from = reopens !== null && reopens > asked ? reopens : asked;
      const today = calendarDayIn(from, creator.timeZone);
      const open = await tx
        .select()
        .from(availabilities)
        .where(
          and(
            eq(availabilities.creatorId, creatorId),
            eq(availabilities.opensTo, 'cam'),
            sql`${availabilities.archivedAt} is null`,
          ),
        );
      // The day before too: a dispo cam of last night may run past midnight.
      const windows = availabilityWindows(
        open.map(availabilityOf),
        addDays(today, -1),
        addDays(today, CAM_HORIZON_DAYS),
        creator.timeZone,
      );
      if (windows.length === 0) return null;
      const until = windows.reduce(
        (latest, window) => Math.max(latest, window.endsAt.getTime()),
        from.getTime(),
      );
      const timed = await tx
        .select({ startsAt: tasks.startsAt, endsAt: tasks.endsAt })
        .from(tasks)
        .where(
          and(
            eq(tasks.creatorId, creatorId),
            eq(tasks.kind, 'timed'),
            sql`${tasks.archivedAt} is null and ${tasks.startsAt} < ${new Date(until)} and ${tasks.endsAt} > ${from}`,
          ),
        );
      const hers = timed.flatMap((row) =>
        row.startsAt === null || row.endsAt === null ? [] : [{ startsAt: row.startsAt, endsAt: row.endsAt }],
      );
      return firstPlacement(minutes, windows, [...hers, ...busy], from);
    });
}
