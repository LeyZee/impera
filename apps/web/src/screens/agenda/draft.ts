import {
  AvailabilityIdSchema,
  CREATOR_AGENDA_DAYS_AHEAD,
  CREATOR_AGENDA_DAYS_BACK,
  CreateAvailabilityBodySchema,
  CreateCreatorTaskBodySchema,
  CreatorTaskIdSchema,
  newId,
  withinAgendaReach,
  type CreateAvailabilityBody,
  type CreateCreatorTaskBody,
  type CreatorTaskCategory,
  type CreatorTaskWhen,
} from '@impera/contracts';

import { addDays, zonedInstant } from '@/scheduling/time';

/*
 * What she types in « Ajouter », and what is sent from it (CR-05). An hour is minutes from her midnight; an end at or
 * before its start is the next day's (22 h – 2 h), as everywhere in the planning. Read in her zone, the server's.
 */

export type TaskWhenKind = 'timed' | 'day' | 'routine';

export interface TaskDraft {
  readonly title: string;
  readonly category: CreatorTaskCategory;
  readonly kind: TaskWhenKind;
  readonly day: string;
  readonly start: number;
  readonly end: number;
  /** ISO weekdays, 1 Monday … 7 Sunday. */
  readonly weekdays: readonly number[];
  readonly purpose: string;
  readonly reminderMinutes: number | null;
}

export type AvailabilityKind = 'weekly' | 'once';

export interface AvailabilityDraft {
  readonly kind: AvailabilityKind;
  readonly day: string;
  readonly weekdays: readonly number[];
  readonly start: number;
  readonly end: number;
}

const MORNING = 10 * 60;
const LAST_HOUR = 23 * 60;

/**
 * The hour a form starts at on `day` (CREA-09): 10 h, or on her today the next full hour when 10 h is past, never
 * later than 23 h.
 */
export function defaultStart(day: string, today: string, nowMinute: number): number {
  if (day !== today) return MORNING;
  const nextHour = (Math.floor(nowMinute / 60) + 1) * 60;
  return Math.min(Math.max(nextHour, MORNING), LAST_HOUR);
}

/**
 * Where « Choisir un moment » opens (CREA-09): the first day of the suggestion's week still ahead, today while a full
 * hour is left in it, at its default hour; the last day of the week when none is left.
 */
export function firstMoment(
  days: readonly string[],
  today: string,
  nowMinute: number,
): { readonly day: string; readonly start: number } {
  const ahead = days.filter((day) => day > today || (day === today && nowMinute < LAST_HOUR));
  const day = ahead[0] ?? days.at(-1) ?? today;
  return { day, start: defaultStart(day, today, nowMinute) };
}

/** A timed span of her day: the end on the next day when it is at or before the start. */
export function spanOf(
  day: string,
  start: number,
  end: number,
  zone: string,
): { startsAt: string; endsAt: string } {
  return {
    startsAt: zonedInstant(day, start, zone).toISOString(),
    endsAt: zonedInstant(end <= start ? addDays(day, 1) : day, end, zone).toISOString(),
  };
}

export function whenOf(draft: TaskDraft, zone: string): CreatorTaskWhen {
  if (draft.kind === 'day') return { kind: 'day', day: draft.day };
  if (draft.kind === 'routine')
    return { kind: 'routine', weekdays: [...draft.weekdays].sort((a, b) => a - b) };
  return { kind: 'timed', ...spanOf(draft.day, draft.start, draft.end, zone) };
}

export type TaskProblem = 'title' | 'weekdays' | 'day';

/** Whether a day typed in a form reads, and falls within her agenda's reach (CREA-14). */
export const dayInReach = (day: string, now: number = Date.now()): boolean =>
  /^\d{4}-\d{2}-\d{2}$/u.test(day) && withinAgendaReach({ kind: 'day', day }, now);

/** A day the date field lets through but her agenda does not reach, or that does not read. */
export const OUT_OF_REACH = 'Choisis un jour entre il y a un an et dans deux ans.';

/** The first and last days a date field offers: her agenda's reach, a day inside it at each end. */
export function reachOf(now: number = Date.now()): { readonly min: string; readonly max: string } {
  const at = (days: number): string => new Date(now + days * 86_400_000).toISOString().slice(0, 10);
  return { min: at(1 - CREATOR_AGENDA_DAYS_BACK), max: at(CREATOR_AGENDA_DAYS_AHEAD - 1) };
}

/** What keeps the task from being saved, in the order of the form. */
export function taskProblems(draft: TaskDraft, now: number = Date.now()): TaskProblem[] {
  const problems: TaskProblem[] = [];
  if (draft.title.trim() === '') problems.push('title');
  if (draft.kind === 'routine' && draft.weekdays.length === 0) problems.push('weekdays');
  if (draft.kind !== 'routine' && !dayInReach(draft.day, now)) problems.push('day');
  return problems;
}

/** A task's id, drawn once when the form opens: sent again after a lost answer, the same task adds nothing. */
export const newTaskId = (): string => newId(CreatorTaskIdSchema);

/** The body of `POST /v1/creator-space/tasks`. */
export function taskBodyOf(draft: TaskDraft, zone: string, id: string): CreateCreatorTaskBody {
  const purpose = draft.purpose.trim();
  return CreateCreatorTaskBodySchema.parse({
    id,
    when: whenOf(draft, zone),
    category: draft.category,
    title: draft.title.trim(),
    purpose: purpose === '' ? null : purpose,
    reminderMinutes: draft.kind === 'timed' ? draft.reminderMinutes : null,
  });
}

/** The ids of a form's dispos, one per weekday (`once` for a dispo of a day), drawn once: a retry adds nothing. */
export function dispoIds(): (key: string) => string {
  const ids = new Map<string, string>();
  return (key) => {
    const known = ids.get(key);
    if (known !== undefined) return known;
    const id = newId(AvailabilityIdSchema);
    ids.set(key, id);
    return id;
  };
}

/** One dispo per weekday chosen, or the one of a day. */
export function availabilityBodiesOf(
  draft: AvailabilityDraft,
  zone: string,
  idFor: (key: string) => string,
): CreateAvailabilityBody[] {
  if (draft.kind === 'once')
    return [
      CreateAvailabilityBodySchema.parse({
        id: idFor('once'),
        when: { kind: 'once', ...spanOf(draft.day, draft.start, draft.end, zone) },
      }),
    ];
  return [...draft.weekdays]
    .sort((a, b) => a - b)
    .map((weekday) =>
      CreateAvailabilityBodySchema.parse({
        id: idFor(String(weekday)),
        when: { kind: 'weekly', weekday, startMinute: draft.start, endMinute: draft.end },
      }),
    );
}
