import {
  CreatorTaskWhenSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  CreatorTaskIdSchema,
  type CreatorStreak,
  type CreatorTask,
  type CreatorTaskWhen,
} from '@impera/contracts';
import {
  and,
  eq,
  inArray,
  schema,
  sql,
  withCreatorAccount,
  type Database,
  type Transaction,
} from '@impera/db';

import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from '../../../scheduling/pure';
import { applyTicks, tickTimely, type Tick } from '../../domain/completion';
import {
  AvailabilityNotFound,
  CreatorTaskChanged,
  CreatorTaskNotFound,
  CreatorTickDayUnprocessable,
  CreatorTickLateUnprocessable,
  SuggestionInPast,
  SuggestionKindChanged,
  SuggestionNotFound,
  SuggestionUndated,
} from '../../domain/errors';
import type { CreatorAgendaStore } from '../../domain/ports';
import { reminderAt } from '../../domain/reminder';
import { dayRecordOf, streakOf, type DayRecord, type DueTask } from '../../domain/streak';
import { decide, weekOf } from '../../domain/suggestions';

import {
  availabilityColumns,
  availabilityViewOf,
  creatorSuggestionOf,
  taskOf,
  tickOf,
  whenColumns,
} from './rows';

const tasks = schema.creatorTasks;
const ticks = schema.creatorTaskTicks;
const availabilities = schema.creatorAvailabilities;
const suggestions = schema.creatorSuggestions;

/** How far back her streak is read: past its last milestone, with room. */
const STREAK_LOOKBACK_DAYS = 400;

type TaskRow = typeof tasks.$inferSelect;

/**
 * Her reminder, with the task's write (CR-05 lot b3): one job per task, replaced on each write, so a move puts it at
 * the new time. A task without a reminder enqueues nothing; a job left from before finds its start changed and rings
 * nothing (`reminderMessage`). A write after the reminder rang (a title changed, same start) puts the job back at a
 * time already past: it runs at once, and `notify` answers `duplicate` for the same task and start.
 */
async function scheduleReminder(tx: Transaction, task: CreatorTask): Promise<void> {
  const at = reminderAt(task);
  if (at === null || task.when.kind !== 'timed') return;
  await tx.execute(
    sql`select public.enqueue_job(
      task => ${'creator_tasks.remind'},
      payload => ${JSON.stringify({ taskId: task.id, startsAt: task.when.startsAt })}::jsonb,
      queue_name => null,
      run_at => ${at.toISOString()}::timestamptz,
      max_attempts => ${JOB_MAX_ATTEMPTS['creator_tasks.remind']}::int,
      job_key => ${`creator_tasks.remind:${task.id}`},
      job_key_mode => ${'replace'}
    )`,
  );
}

/**
 * Her gesture announced (VEI-01 d2), in the transaction that records it: one job per suggestion (her gesture happens
 * once). Whoever listens (the trend watch) decides what it means; the agenda knows none.
 */
async function announceDecision(
  tx: Transaction,
  decision: {
    readonly creatorId: string;
    readonly suggestionId: string;
    readonly state: 'accepted' | 'declined';
    readonly day: string;
  },
): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => ${'creator_tasks.suggestion_decided'},
      payload => ${JSON.stringify(decision)}::jsonb,
      queue_name => null,
      run_at => null,
      max_attempts => ${JOB_MAX_ATTEMPTS['creator_tasks.suggestion_decided']}::int,
      job_key => ${`creator_tasks.suggestion_decided:${decision.suggestionId}`},
      job_key_mode => ${'preserve_run_at'}
    )`,
  );
}

/** The day a task falls on in her zone; a routine, which has none, takes `fallback`. */
function dayOfTask(when: CreatorTaskWhen, zone: string, fallback: string): string {
  if (when.kind === 'timed') return calendarDayIn(new Date(when.startsAt), zone);
  if (when.kind === 'day') return when.day;
  return fallback;
}

/** Whether a moment is over: a timed one ended, a day before her today. A routine is never over. */
function isOver(when: CreatorTaskWhen, zone: string, now: Date): boolean {
  if (when.kind === 'timed') return Date.parse(when.endsAt) <= now.getTime();
  if (when.kind === 'day') return when.day < calendarDayIn(now, zone);
  return false;
}

export async function zoneOf(tx: Transaction, creatorId: string): Promise<string> {
  const [creator] = await tx
    .select({ timeZone: schema.creators.timezone })
    .from(schema.creators)
    .where(eq(schema.creators.id, creatorId));
  if (creator === undefined) throw new Error(`creator ${creatorId} of a creator account not found`);
  return creator.timeZone;
}

/** Whether a task is due on one of her days: its day, the day it starts, or one of its weekdays. */
function dueOn(row: TaskRow, day: string, zone: string): boolean {
  if (row.kind === 'day') return row.day === day;
  if (row.kind === 'timed') return row.startsAt !== null && calendarDayIn(row.startsAt, zone) === day;
  if (row.weekdays?.includes(isoWeekday(day)) !== true) return false;
  // A routine counts from the day it entered her agenda to the day before it left it.
  if (calendarDayIn(row.createdAt, zone) > day) return false;
  return row.archivedAt === null || calendarDayIn(row.archivedAt, zone) > day;
}

/**
 * Her days back to `STREAK_LOOKBACK_DAYS`, today included: her routine of each day against her ticks of it. Under her
 * own account the policies show her rows only; the game's job (ADR 0107) passes her creator, on the admin connection.
 */
export async function herDayRecords(
  tx: Transaction,
  zone: string,
  now: Date,
  creatorId: string | null = null,
): Promise<{ readonly today: string; readonly records: DayRecord[] }> {
  const today = calendarDayIn(now, zone);
  const since = addDays(today, -STREAK_LOOKBACK_DAYS);
  const routine = await tx
    .select()
    .from(tasks)
    .where(and(eq(tasks.kind, 'routine'), creatorId === null ? undefined : eq(tasks.creatorId, creatorId)));
  const done = await tx
    .select()
    .from(ticks)
    .where(
      and(
        sql`${ticks.day} between ${since} and ${today}`,
        creatorId === null ? undefined : eq(ticks.creatorId, creatorId),
      ),
    );
  const doneTicks: Tick[] = done.map((row) => ({ taskId: row.taskId, day: row.day, doneAt: row.doneAt }));
  const records: DayRecord[] = [];
  for (let day = since; day <= today; day = addDays(day, 1)) {
    const due: DueTask[] = routine
      .filter((row) => dueOn(row, day, zone))
      .map((row) => ({ taskId: row.id, essential: row.essential }));
    records.push(dayRecordOf(day, due, doneTicks));
  }
  return { today, records };
}

/** Her streak today, from her days. */
async function streakNow(tx: Transaction, zone: string, now: Date): Promise<CreatorStreak> {
  const { today, records } = await herDayRecords(tx, zone, now);
  return streakOf(records, today);
}

const sameTask = (
  stored: CreatorTask,
  body: Omit<CreatorTask, 'essential' | 'shootBrief' | 'reelBrief' | 'createdAt'>,
): boolean =>
  JSON.stringify({
    ...stored,
    essential: undefined,
    shootBrief: undefined,
    reelBrief: undefined,
    createdAt: undefined,
  }) ===
  JSON.stringify({
    ...body,
    essential: undefined,
    shootBrief: undefined,
    reelBrief: undefined,
    createdAt: undefined,
  });

/** `withCreatorAccount` for every reading and writing of her agenda (CR-05). */
export function createDrizzleCreatorAgendaStore(db: Database): CreatorAgendaStore {
  async function liveTask(tx: Transaction, taskId: string): Promise<TaskRow> {
    const [row] = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), sql`${tasks.archivedAt} is null`))
      .for('update');
    if (row === undefined) throw new CreatorTaskNotFound();
    return row;
  }

  return {
    agenda: (userId, query, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const zone = await zoneOf(tx, creatorId);
        const from = wallClockToInstant(query.from, 0, zone);
        const to = wallClockToInstant(addDays(query.to, 1), 0, zone);
        const taskRows = await tx
          .select()
          .from(tasks)
          .where(
            and(
              sql`${tasks.archivedAt} is null`,
              sql`(${tasks.kind} = 'routine'
                or (${tasks.kind} = 'day' and ${tasks.day} between ${query.from} and ${query.to})
                or (${tasks.kind} = 'timed' and ${tasks.startsAt} < ${to} and ${tasks.endsAt} > ${from}))`,
            ),
          )
          .orderBy(tasks.startsAt, tasks.day, tasks.createdAt);
        const tickRows = await tx
          .select()
          .from(ticks)
          .where(sql`${ticks.day} between ${query.from} and ${query.to}`)
          .orderBy(ticks.day, ticks.doneAt);
        const availabilityRows = await tx
          .select()
          .from(availabilities)
          .where(sql`${availabilities.archivedAt} is null`)
          .orderBy(availabilities.createdAt);
        const suggestionRows = await tx
          .select()
          .from(suggestions)
          .where(
            and(
              eq(suggestions.state, 'suggested'),
              sql`${suggestions.week} >= ${weekOf(query.from)}`,
              sql`${suggestions.week} <= ${weekOf(query.to)}`,
            ),
          )
          .orderBy(suggestions.week, suggestions.createdAt);
        return {
          timeZone: zone,
          today: calendarDayIn(now, zone),
          tasks: taskRows.map(taskOf),
          ticks: tickRows.map(tickOf),
          availabilities: availabilityRows.map(availabilityViewOf),
          suggestions: suggestionRows.map(creatorSuggestionOf),
          streak: await streakNow(tx, zone, now),
        };
      }),

    createTask: (userId, body) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const values = {
          id: body.id,
          creatorId,
          ...whenColumns(body.when),
          category: body.category,
          title: body.title,
          purpose: body.purpose,
          reminderMinutes: body.when.kind === 'timed' ? body.reminderMinutes : null,
          createdBy: userId,
        };
        const [inserted] = await tx.insert(tasks).values(values).onConflictDoNothing().returning();
        if (inserted !== undefined) {
          const task = taskOf(inserted);
          await scheduleReminder(tx, task);
          return task;
        }
        // Replayed from her phone: the same task answers itself, anything else was another use of the id.
        const [stored] = await tx.select().from(tasks).where(eq(tasks.id, body.id));
        if (stored?.archivedAt !== null) throw new CreatorTaskChanged();
        const task = taskOf(stored);
        if (!sameTask(task, { ...body, reminderMinutes: values.reminderMinutes }))
          throw new CreatorTaskChanged();
        return task;
      }),

    updateTask: (userId, taskId, body) =>
      withCreatorAccount(db, userId, async (tx) => {
        const row = await liveTask(tx, taskId);
        const current = taskOf(row);
        const when: CreatorTaskWhen = body.when ?? current.when;
        // An essential task stays in her routine: she moves its days, never out of it.
        if (row.essential && when.kind !== 'routine') throw new CreatorTaskChanged();
        const reminderMinutes =
          when.kind === 'timed' ? (body.reminderMinutes ?? current.reminderMinutes) : null;
        const [updated] = await tx
          .update(tasks)
          .set({
            ...whenColumns(CreatorTaskWhenSchema.parse(when)),
            category: body.category ?? current.category,
            title: body.title ?? current.title,
            purpose: body.purpose === undefined ? current.purpose : body.purpose,
            reminderMinutes,
            updatedAt: sql`now()`,
          })
          .where(eq(tasks.id, taskId))
          .returning();
        if (updated === undefined) throw new CreatorTaskNotFound();
        const task = taskOf(updated);
        await scheduleReminder(tx, task);
        return task;
      }),

    archiveTask: (userId, taskId) =>
      withCreatorAccount(db, userId, async (tx) => {
        const [row] = await tx
          .select({ archivedAt: tasks.archivedAt })
          .from(tasks)
          .where(eq(tasks.id, taskId));
        if (row === undefined) throw new CreatorTaskNotFound();
        if (row.archivedAt !== null) return;
        await tx
          .update(tasks)
          .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(tasks.id, taskId));
      }),

    tick: (userId, body, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const zone = await zoneOf(tx, creatorId);
        const ids = [...new Set(body.ticks.map((tick) => tick.taskId))];
        const rows = await tx
          .select()
          .from(tasks)
          .where(and(inArray(tasks.id, ids), sql`${tasks.archivedAt} is null`));
        const byId = new Map(rows.map((row) => [row.id, row]));
        const missing = ids.filter((id) => !byId.has(id));
        if (missing.length > 0) throw new CreatorTaskNotFound({ taskIds: missing });
        const offDay = [
          ...new Set(
            body.ticks
              .filter((tick) => !dueOnTick(byId.get(tick.taskId), tick.day, zone))
              .map((tick) => tick.taskId),
          ),
        ];
        if (offDay.length > 0) throw new CreatorTickDayUnprocessable(offDay);
        const late = [
          ...new Set(
            body.ticks
              .filter(
                (tick) =>
                  !tickTimely(
                    { taskId: tick.taskId, day: tick.day, doneAt: new Date(tick.doneAt) },
                    byId.get(tick.taskId)?.kind === 'routine',
                    now,
                    zone,
                  ),
              )
              .map((tick) => tick.taskId),
          ),
        ];
        if (late.length > 0) throw new CreatorTickLateUnprocessable(late);
        const existing = await tx.select().from(ticks).where(inArray(ticks.taskId, ids));
        const { added } = applyTicks(
          existing.map((row) => ({ taskId: row.taskId, day: row.day, doneAt: row.doneAt })),
          body.ticks.map((tick) => ({ taskId: tick.taskId, day: tick.day, doneAt: new Date(tick.doneAt) })),
        );
        const written =
          added.length === 0
            ? []
            : await tx
                .insert(ticks)
                .values(added.map((tick) => ({ ...tick, creatorId, createdBy: userId })))
                // Two phones replaying at once: the first one stays.
                .onConflictDoNothing()
                .returning({ taskId: ticks.taskId });
        return { added: written.length, streak: await streakNow(tx, zone, now) };
      }),

    untick: (userId, taskId, day, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const zone = await zoneOf(tx, creatorId);
        await liveTask(tx, taskId);
        await tx.delete(ticks).where(and(eq(ticks.taskId, taskId), eq(ticks.day, day)));
        return { streak: await streakNow(tx, zone, now) };
      }),

    createAvailability: (userId, body) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const values = { id: body.id, creatorId, ...availabilityColumns(body.when), createdBy: userId };
        const [inserted] = await tx.insert(availabilities).values(values).onConflictDoNothing().returning();
        if (inserted !== undefined) return availabilityViewOf(inserted);
        const [stored] = await tx.select().from(availabilities).where(eq(availabilities.id, body.id));
        if (stored?.archivedAt !== null) throw new CreatorTaskChanged();
        const view = availabilityViewOf(stored);
        if (JSON.stringify(view) !== JSON.stringify(availabilityViewOf({ ...stored, ...values })))
          throw new CreatorTaskChanged();
        return view;
      }),

    archiveAvailability: (userId, availabilityId) =>
      withCreatorAccount(db, userId, async (tx) => {
        const [row] = await tx
          .select({ archivedAt: availabilities.archivedAt })
          .from(availabilities)
          .where(eq(availabilities.id, availabilityId));
        if (row === undefined) throw new AvailabilityNotFound();
        if (row.archivedAt !== null) return;
        await tx
          .update(availabilities)
          .set({ archivedAt: sql`now()` })
          .where(eq(availabilities.id, availabilityId));
      }),

    accept: (userId, suggestionId, body, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const [row] = await tx
          .select()
          .from(suggestions)
          .where(eq(suggestions.id, suggestionId))
          .for('update');
        if (row === undefined) throw new SuggestionNotFound();
        const { changed } = decide(
          row.state === 'accepted' || row.state === 'declined' ? row.state : 'suggested',
          'accept',
        );
        if (!changed) {
          // Accepted already, a tap again or a replay: the task it made.
          const [task] =
            row.taskId === null ? [] : await tx.select().from(tasks).where(eq(tasks.id, row.taskId));
          if (task === undefined) throw new SuggestionNotFound();
          return taskOf(task);
        }
        const proposed = creatorSuggestionOf(row);
        const when = body.when ?? proposed.when;
        if (when === null) throw new SuggestionUndated();
        // Moved, never changed in kind: what is essential is what the agency proposed as her routine.
        if (when.kind !== row.kind) throw new SuggestionKindChanged();
        const zone = await zoneOf(tx, creatorId);
        if (isOver(when, zone, now)) throw new SuggestionInPast();
        const [task] = await tx
          .insert(tasks)
          .values({
            id: newId(CreatorTaskIdSchema),
            creatorId,
            ...whenColumns(when),
            category: row.category,
            title: row.title,
            purpose: row.purpose,
            // Her shooting sheet, hers to read from now on and never hers to edit (VEI-01 d).
            shootBrief: row.shootBrief,
            // Copied once, as she accepted it, read again by its schema (ADR 0082 § 3).
            reelBrief: proposed.reelBrief,
            // The agency's routine, once hers, counts for her streak (glossary « Routine »).
            essential: row.kind === 'routine',
            suggestionId: row.id,
            createdBy: userId,
          })
          .returning();
        if (task === undefined) throw new Error('creator_tasks insert returned nothing');
        await tx
          .update(suggestions)
          .set({
            state: 'accepted',
            taskId: task.id,
            decidedAt: now,
            decidedOn: calendarDayIn(now, zone),
            updatedAt: sql`now()`,
          })
          .where(eq(suggestions.id, row.id));
        await announceDecision(tx, {
          creatorId,
          suggestionId: row.id,
          state: 'accepted',
          day: dayOfTask(when, zone, calendarDayIn(now, zone)),
        });
        return taskOf(task);
      }),

    decline: (userId, suggestionId, body, now) =>
      withCreatorAccount(db, userId, async (tx, creatorId) => {
        const [row] = await tx
          .select()
          .from(suggestions)
          .where(eq(suggestions.id, suggestionId))
          .for('update');
        if (row === undefined) throw new SuggestionNotFound();
        const { changed } = decide(
          row.state === 'accepted' || row.state === 'declined' ? row.state : 'suggested',
          'decline',
        );
        if (!changed) return;
        const zone = await zoneOf(tx, creatorId);
        await tx
          .update(suggestions)
          .set({
            state: 'declined',
            reason: body.reason ?? null,
            decidedAt: now,
            decidedOn: calendarDayIn(now, zone),
            updatedAt: sql`now()`,
          })
          .where(eq(suggestions.id, row.id));
        await announceDecision(tx, {
          creatorId,
          suggestionId: row.id,
          state: 'declined',
          day: calendarDayIn(now, zone),
        });
      }),
  };
}

function dueOnTick(row: TaskRow | undefined, day: string, zone: string): boolean {
  if (row === undefined) return false;
  if (row.kind !== 'routine') return dueOn(row, day, zone);
  // A routine is ticked on its weekdays, from the day it entered her agenda.
  return row.weekdays?.includes(isoWeekday(day)) === true && calendarDayIn(row.createdAt, zone) <= day;
}
