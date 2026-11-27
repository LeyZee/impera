import { DayItemSchema, type DayItem } from '@impera/contracts';
import {
  and,
  eq,
  onCreatorList,
  schema,
  sql,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { calendarDayIn } from '../../../scheduling/pure';
import { canTickDay, DAY_DEFAULTS, targetOf } from '../../domain/day';
import { CreatorWeekForbidden, DayItemLate } from '../../domain/errors';
import type { DayTickStore } from '../../domain/ports';

const ticks = schema.creatorDayTicks;

async function zoneOf(tx: Transaction, creatorId: string): Promise<string> {
  const [creator] = await tx
    .select({ timeZone: schema.creators.timezone })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  // Her own row, read under her account: always there for a linked account.
  return creator?.timeZone ?? 'Europe/Paris';
}

const todayOf = async (tx: Transaction, creatorId: string, now: Date): Promise<string> =>
  calendarDayIn(now, await zoneOf(tx, creatorId));

/** Her day on her own account (`withCreatorAccount`): the row policies keep her to her own creator. */
export function createDrizzleDayTickStore(db: Database): DayTickStore {
  return {
    read: (userId, day, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const timeZone = await zoneOf(tx, creatorId);
        const today = calendarDayIn(now, timeZone);
        const shown = day ?? today;
        const rows = await tx
          .select({ item: ticks.item, done: ticks.done })
          .from(ticks)
          .where(and(eq(ticks.creatorId, creatorId), eq(ticks.day, shown)));
        const counts: Partial<Record<DayItem, number>> = {};
        for (const row of rows) {
          const item = DayItemSchema.safeParse(row.item);
          if (item.success) counts[item.data] = row.done;
        }
        return { day: shown, today, timeZone, done: counts };
      }),

    teamDays: (creatorId, userId, from, to, now) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        // Her owner and an active manager read where she is; a chatter does not (trous béants n° 11).
        if (scope !== 'owner' && scope !== 'agency') throw new CreatorWeekForbidden('read');
        // A manager reads only the creators on his own list (avis Sécurité, 21/11).
        if (scope === 'agency' && !(await onCreatorList(tx, userId, creatorId)))
          throw new CreatorWeekForbidden('read');
        const rows = await tx
          .select({ day: ticks.day, item: ticks.item, done: ticks.done })
          .from(ticks)
          .where(
            and(eq(ticks.creatorId, creatorId), sql`${ticks.day} between ${from}::date and ${to}::date`),
          );
        const days = new Map<string, Partial<Record<DayItem, number>>>();
        for (const row of rows) {
          const item = DayItemSchema.safeParse(row.item);
          if (!item.success) continue;
          const counts = days.get(row.day) ?? {};
          counts[item.data] = row.done;
          days.set(row.day, counts);
        }
        const timeZone = await zoneOf(tx, creatorId);
        return { today: calendarDayIn(now, timeZone), timeZone, days };
      }),

    write: (userId, day, item, done, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        if (!canTickDay(day, await todayOf(tx, creatorId, now))) throw new DayItemLate();
        // What she did counts up to what the line asks: a tap too many changes nothing.
        const count = Math.min(done, targetOf(item, DAY_DEFAULTS));
        await tx
          .insert(ticks)
          .values({ creatorId, day, item, done: count, createdBy: userId, updatedBy: userId })
          .onConflictDoUpdate({
            target: [ticks.creatorId, ticks.day, ticks.item],
            set: { done: count, updatedBy: userId, updatedAt: sql`now()` },
            // The same count again writes nothing (a double tap, a replay back online).
            setWhere: sql`${ticks.done} is distinct from ${count}`,
          });
      }),
  };
}
