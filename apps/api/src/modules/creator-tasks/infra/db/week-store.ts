import {
  DELIVERY_TITLE,
  SHOOT_DAY_TITLE,
  SuggestionStateSchema,
  WeekNeedSchema,
  WeekRoleSchema,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withCreatorAccount,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';

import { calendarDayIn } from '../../../scheduling/pure';
import {
  ShootItemLate,
  ShootItemNotAccepted,
  ShootItemNotFound,
  SuggestionForbidden,
  SuggestionIdTaken,
} from '../../domain/errors';
import type { HerWeekFrame, WeekAgendaStore } from '../../domain/ports';
import { shootDayDone, shootItemTimely } from '../../domain/week';

const tasks = schema.creatorTasks;
const suggestions = schema.creatorSuggestions;
const lines = schema.creatorShootItems;
const ticks = schema.creatorTaskTicks;

/** What each frame of her week is for, in her words (ADR 0140 § 7). */
const SHOOT_DAY_PURPOSE = 'Tout ce qu’il y a à tourner ce jour-là, à cocher au fur et à mesure';
const DELIVERY_PURPOSE = 'Déposer tout ce que tu as tourné cette semaine, avant dimanche 23 h';

async function zoneOf(tx: Transaction, creatorId: string): Promise<string> {
  const [creator] = await tx
    .select({ timeZone: schema.creators.timezone })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  if (creator === undefined) throw new SuggestionForbidden();
  return creator.timeZone;
}

/** Inserts a frame of her week, or finds it again under its id: a replay writes nothing, another frame under it is refused. */
async function frame(
  tx: Transaction,
  values: typeof suggestions.$inferInsert & { id: string; day: string },
): Promise<void> {
  const [known] = await tx.select().from(suggestions).where(eq(suggestions.id, values.id));
  if (known !== undefined) {
    if (known.weekRole !== values.weekRole || known.week !== values.week) throw new SuggestionIdTaken();
    return;
  }
  const [row] = await tx
    .insert(suggestions)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: suggestions.id });
  // An id already used for another creator, which her RLS hides: a conflict, never a 500.
  if (row === undefined) throw new SuggestionIdTaken();
}

/** Her ticks of the day's task follow its lines: all done, ticked; one taken back, the tick goes. */
async function followLines(
  tx: Transaction,
  suggestionId: string,
  task: { readonly id: string; readonly day: string; readonly creatorId: string },
  userId: string,
  now: Date,
): Promise<void> {
  const all = await tx
    .select({ doneAt: lines.doneAt })
    .from(lines)
    .where(eq(lines.suggestionId, suggestionId));
  if (shootDayDone(all.map((line) => ({ done: line.doneAt !== null })))) {
    await tx
      .insert(ticks)
      .values({ taskId: task.id, creatorId: task.creatorId, day: task.day, doneAt: now, createdBy: userId })
      .onConflictDoNothing();
    return;
  }
  await tx.delete(ticks).where(and(eq(ticks.taskId, task.id), eq(ticks.day, task.day)));
}

/**
 * Her week in her agenda (ADR 0140): the owner writes it (`withTenantMember`), she reads it and ticks its lines in her
 * own account (`withCreatorAccount`). Nothing here computes what she shoots: that is the week module's.
 */
export function createDrizzleWeekAgendaStore(db: Database): WeekAgendaStore {
  return {
    suggestWeek: (creatorId, userId, frames) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope !== 'owner') throw new SuggestionForbidden();
        await zoneOf(tx, creatorId);
        const common = {
          creatorId,
          origin: 'agency',
          kind: 'day',
          category: 'shoot',
          week: frames.week,
          createdBy: userId,
          startsAt: null,
          endsAt: null,
          weekdays: null,
          minutes: null,
        } as const;
        for (const shootDay of frames.shootDays) {
          await frame(tx, {
            ...common,
            id: shootDay.id,
            day: shootDay.day,
            title: SHOOT_DAY_TITLE,
            purpose: SHOOT_DAY_PURPOSE,
            weekRole: 'shoot_day',
          });
          if (shootDay.lines.length === 0) continue;
          await tx
            .insert(lines)
            .values(
              shootDay.lines.map((line, position) => ({
                id: line.id,
                creatorId,
                suggestionId: shootDay.id,
                position,
                need: line.need,
                label: line.label,
                sheet: line.sheet,
                count: line.count,
                requestId: line.requestId,
                createdBy: userId,
              })),
            )
            .onConflictDoNothing();
        }
        await frame(tx, {
          ...common,
          id: frames.delivery.id,
          day: frames.delivery.day,
          title: DELIVERY_TITLE,
          purpose: DELIVERY_PURPOSE,
          weekRole: 'delivery',
        });
      }),

    herWeek: (userId, week, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const timeZone = await zoneOf(tx, creatorId);
        const rows = await tx
          .select()
          .from(suggestions)
          .where(and(eq(suggestions.week, week), sql`${suggestions.weekRole} is not null`))
          .orderBy(suggestions.day);
        const ids = rows.map((row) => row.id);
        const born =
          ids.length === 0
            ? []
            : await tx
                .select({
                  id: tasks.id,
                  suggestionId: tasks.suggestionId,
                  day: tasks.day,
                  archivedAt: tasks.archivedAt,
                })
                .from(tasks)
                .where(inArray(tasks.suggestionId, ids));
        const theirLines =
          ids.length === 0
            ? []
            : await tx.select().from(lines).where(inArray(lines.suggestionId, ids)).orderBy(lines.position);
        const frames: HerWeekFrame[] = rows.flatMap((row) => {
          const role = WeekRoleSchema.safeParse(row.weekRole);
          if (!role.success || row.day === null) return [];
          const task = born.find((one) => one.suggestionId === row.id && one.archivedAt === null);
          return [
            {
              suggestionId: row.id,
              role: role.data,
              state: SuggestionStateSchema.parse(row.state),
              taskId: task?.id ?? null,
              day: task?.day ?? row.day,
              lines: theirLines
                .filter((line) => line.suggestionId === row.id)
                .map((line) => ({
                  id: line.id,
                  need: WeekNeedSchema.parse(line.need),
                  label: line.label,
                  sheet: line.sheet,
                  count: line.count,
                  requestId: line.requestId,
                  done: line.doneAt !== null,
                })),
            },
          ];
        });
        return { creatorId, timeZone, today: calendarDayIn(now, timeZone), frames };
      }),

    tickLine: (userId, lineId, done, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const [line] = await tx.select().from(lines).where(eq(lines.id, lineId));
        if (line === undefined) throw new ShootItemNotFound();
        const [task] = await tx
          .select({ id: tasks.id, day: tasks.day, archivedAt: tasks.archivedAt })
          .from(tasks)
          .where(eq(tasks.suggestionId, line.suggestionId));
        if (task?.day == null || task.archivedAt !== null) throw new ShootItemNotAccepted();
        const zone = await zoneOf(tx, creatorId);
        if (!shootItemTimely(task.day, calendarDayIn(now, zone))) throw new ShootItemLate();
        // The same gesture again changes nothing (a double tap, a replay back online).
        if ((line.doneAt !== null) === done) return;
        await tx
          .update(lines)
          .set(done ? { doneAt: now, doneBy: userId } : { doneAt: null, doneBy: null })
          .where(eq(lines.id, lineId));
        await followLines(tx, line.suggestionId, { id: task.id, day: task.day, creatorId }, userId, now);
      }),
  };
}

/** The weekdays she shot on the week starting `week` (ADR 0140 § 1), her tasks as she kept them; on the admin connection. */
export async function shootDaysOfWeekUnscoped(
  tx: Transaction,
  creatorId: string,
  week: string,
): Promise<readonly string[]> {
  const rows = await tx
    .select({ day: tasks.day })
    .from(tasks)
    .innerJoin(suggestions, eq(suggestions.id, tasks.suggestionId))
    .where(
      and(
        eq(tasks.creatorId, creatorId),
        eq(suggestions.week, week),
        eq(suggestions.weekRole, 'shoot_day'),
        sql`${tasks.archivedAt} is null`,
      ),
    );
  return rows.flatMap((row) => (row.day === null ? [] : [row.day]));
}

/**
 * How many minutes of dispo she opens each weekday, from her weekly dispos (1 Monday … 7 Sunday): where her first
 * shooting days fall when she never had any (ADR 0140 § 1). On the admin connection, bounded to her.
 */
export async function dispoMinutesByWeekdayUnscoped(
  tx: Transaction,
  creatorId: string,
): Promise<ReadonlyMap<number, number>> {
  const rows = await tx
    .select({
      weekday: schema.creatorAvailabilities.weekday,
      startMinute: schema.creatorAvailabilities.startMinute,
      endMinute: schema.creatorAvailabilities.endMinute,
    })
    .from(schema.creatorAvailabilities)
    .where(
      and(
        eq(schema.creatorAvailabilities.creatorId, creatorId),
        eq(schema.creatorAvailabilities.kind, 'weekly'),
        sql`${schema.creatorAvailabilities.archivedAt} is null`,
      ),
    );
  const minutes = new Map<number, number>();
  for (const row of rows) {
    if (row.weekday === null || row.startMinute === null || row.endMinute === null) continue;
    // An end at or before its start is the next day's (a dispo across midnight).
    const length =
      row.endMinute > row.startMinute
        ? row.endMinute - row.startMinute
        : row.endMinute + 1440 - row.startMinute;
    minutes.set(row.weekday, (minutes.get(row.weekday) ?? 0) + length);
  }
  return minutes;
}
