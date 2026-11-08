import {
  AgencySuggestionSchema,
  AvailabilityIdSchema,
  CreatorSuggestionSchema,
  CreatorTaskIdSchema,
  CreatorTaskSchema,
  SuggestionIdSchema,
  type AgencySuggestion,
  type AvailabilityView,
  type AvailabilityWhen,
  type CreatorSuggestion,
  type CreatorTask,
  type CreatorTaskWhen,
  type CreatorTick,
  type SuggestionFollowUp,
} from '@impera/contracts';
import type { schema } from '@impera/db';

import type { Availability } from '../../domain/availability';

/** Rows of her agenda's tables to the contracts' objects, and back. A row the checks let through always maps. */

type TaskRow = typeof schema.creatorTasks.$inferSelect;
type TickRow = typeof schema.creatorTaskTicks.$inferSelect;
type AvailabilityRow = typeof schema.creatorAvailabilities.$inferSelect;
type SuggestionRow = typeof schema.creatorSuggestions.$inferSelect;

/** The columns of a `when`: the other kinds' columns at `null`. */
export function whenColumns(when: CreatorTaskWhen): {
  kind: CreatorTaskWhen['kind'];
  startsAt: Date | null;
  endsAt: Date | null;
  day: string | null;
  weekdays: number[] | null;
} {
  const none = { startsAt: null, endsAt: null, day: null, weekdays: null };
  switch (when.kind) {
    case 'timed':
      return { ...none, kind: 'timed', startsAt: new Date(when.startsAt), endsAt: new Date(when.endsAt) };
    case 'day':
      return { ...none, kind: 'day', day: when.day };
    case 'routine':
      return { ...none, kind: 'routine', weekdays: [...when.weekdays].sort((a, b) => a - b) };
  }
}

function whenOf(
  row: Pick<TaskRow, 'kind' | 'startsAt' | 'endsAt' | 'day' | 'weekdays'>,
): CreatorTaskWhen | null {
  if (row.kind === 'timed')
    return row.startsAt === null || row.endsAt === null
      ? null
      : { kind: 'timed', startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() };
  if (row.kind === 'day') return row.day === null ? null : { kind: 'day', day: row.day };
  return row.weekdays === null ? null : { kind: 'routine', weekdays: row.weekdays };
}

export function taskOf(row: TaskRow): CreatorTask {
  return CreatorTaskSchema.parse({
    id: CreatorTaskIdSchema.parse(row.id),
    when: whenOf(row),
    category: row.category,
    title: row.title,
    purpose: row.purpose,
    shootBrief: row.shootBrief,
    // Parsed on read (docs/architecture/jsonb.md): the schema refuses a sheet out of its bounds.
    reelBrief: row.reelBrief,
    essential: row.essential,
    reminderMinutes: row.reminderMinutes,
    createdAt: row.createdAt.toISOString(),
  });
}

export const tickOf = (row: TickRow): CreatorTick => ({
  taskId: CreatorTaskIdSchema.parse(row.taskId),
  day: row.day,
  doneAt: row.doneAt.toISOString(),
});

function availabilityWhenOf(row: AvailabilityRow): AvailabilityWhen {
  if (row.kind === 'weekly' && row.weekday !== null && row.startMinute !== null && row.endMinute !== null)
    return { kind: 'weekly', weekday: row.weekday, startMinute: row.startMinute, endMinute: row.endMinute };
  if (row.kind === 'once' && row.startsAt !== null && row.endsAt !== null)
    return { kind: 'once', startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() };
  throw new Error(`creator_availabilities ${row.id}: a row its check should have refused`);
}

export const availabilityViewOf = (row: AvailabilityRow): AvailabilityView => ({
  id: AvailabilityIdSchema.parse(row.id),
  when: availabilityWhenOf(row),
});

/** A dispo as the pure rules read it. */
export function availabilityOf(row: AvailabilityRow): Availability {
  const when = availabilityWhenOf(row);
  return when.kind === 'weekly'
    ? when
    : { kind: 'once', startsAt: new Date(when.startsAt), endsAt: new Date(when.endsAt) };
}

export function availabilityColumns(when: AvailabilityWhen): {
  kind: AvailabilityWhen['kind'];
  weekday: number | null;
  startMinute: number | null;
  endMinute: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
} {
  return when.kind === 'weekly'
    ? {
        kind: 'weekly',
        weekday: when.weekday,
        startMinute: when.startMinute,
        endMinute: when.endMinute,
        startsAt: null,
        endsAt: null,
      }
    : {
        kind: 'once',
        weekday: null,
        startMinute: null,
        endMinute: null,
        startsAt: new Date(when.startsAt),
        endsAt: new Date(when.endsAt),
      };
}

const creatorSide = (row: SuggestionRow) => ({
  id: SuggestionIdSchema.parse(row.id),
  when: whenOf(row),
  week: row.week,
  minutes: row.minutes,
  category: row.category,
  title: row.title,
  purpose: row.purpose,
  shootBrief: row.shootBrief,
  reelBrief: row.reelBrief,
  essential: row.kind === 'routine',
});

/** A suggestion as she reads it: never its origin, its author nor its state's history. */
export const creatorSuggestionOf = (row: SuggestionRow): CreatorSuggestion =>
  CreatorSuggestionSchema.parse(creatorSide(row));

/** A suggestion as the agency reads it, with what became of it once accepted (`null` until then). */
export const agencySuggestionOf = (row: SuggestionRow, task: SuggestionFollowUp | null): AgencySuggestion =>
  AgencySuggestionSchema.parse({
    ...creatorSide(row),
    origin: row.origin,
    state: row.state,
    reason: row.reason,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    task,
  });
