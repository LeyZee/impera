import { schema, sql, withCreatorAccount, type Database } from '@impera/db';

import { feedEntryOf, type AgendaFeedEntry } from '../../domain/feed';

import { taskOf } from './rows';

const tasks = schema.creatorTasks;

/**
 * Her tasks for her calendar link's feed (CR-05 lot c2), read with her own rights (`withCreatorAccount`, as her
 * agenda): those with hours that cross the window, and those of a day inside it. A day is compared on the calendar
 * days of the window's two ends, which the feed's weeks before and after make wide enough.
 */
export function createDrizzleAgendaFeed(
  db: Database,
): (
  userId: string,
  window: { readonly from: Date; readonly to: Date },
) => Promise<readonly AgendaFeedEntry[]> {
  return (userId, window) =>
    withCreatorAccount(db, userId, async (tx) => {
      const fromDay = window.from.toISOString().slice(0, 10);
      const toDay = window.to.toISOString().slice(0, 10);
      const rows = await tx
        .select()
        .from(tasks)
        .where(
          sql`${tasks.archivedAt} is null and (
            (${tasks.kind} = 'timed'
              and ${tasks.startsAt} < ${window.to.toISOString()}::timestamptz
              and ${tasks.endsAt} > ${window.from.toISOString()}::timestamptz)
            or (${tasks.kind} = 'day' and ${tasks.day} between ${fromDay}::date and ${toDay}::date)
          )`,
        )
        .orderBy(tasks.startsAt, tasks.day, tasks.id);
      return rows.map((row) => feedEntryOf(taskOf(row))).filter((entry) => entry !== null);
    });
}
