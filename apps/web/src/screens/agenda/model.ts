import type {
  AvailabilityView,
  CreatorAgenda,
  CreatorSuggestion,
  CreatorTask,
  CreatorTick,
} from '@impera/contracts';

import { addDays, dayOf, minuteOf, MINUTES_PER_DAY, weekdayOf, zonedInstant } from '@/scheduling/time';

/*
 * Her agenda read for one day (CR-05, ADR 0042 § 3), pure: what she has to do, what is timed, where she is free. Read
 * in her zone, the one the server answers with, so that her phone abroad still shows her days as the server counts
 * them. Only two words reach her: a tâche and a dispo (« créneau » is the shifts', ADR 0049).
 */

/** A task of the day to tick: of the day, of her routine, or timed (it is ticked too). */
export interface DayTask {
  readonly task: CreatorTask;
  readonly done: boolean;
}

/**
 * A timed task on one of her days, in minutes from her midnight (the end may pass 1440: it ends the next day). On the
 * day after a task that passes midnight, it is there too, `carried`, from 0 h to its end (CREA-02).
 */
export interface TimedTask extends DayTask {
  readonly start: number;
  readonly end: number;
  /** The day it starts: where it is ticked and counted. */
  readonly day: string;
  /** Started on a day before: shown, never counted twice. */
  readonly carried: boolean;
  /** How long it lasts, from its instants: a day of clock change counts the hour it adds or skips (CREA-05). */
  readonly length: number;
}

/** A dispo on one of her days, in minutes from her midnight. */
export interface DayWindow {
  readonly id: string;
  readonly start: number;
  readonly end: number;
}

export interface DayPlan {
  readonly day: string;
  /** Her tasks of the day and of her routine, essential first, then by title. */
  readonly todo: readonly DayTask[];
  /** Her timed tasks starting that day, by start. */
  readonly timed: readonly TimedTask[];
  readonly windows: readonly DayWindow[];
  /** The agency's suggestions dated that day, still to decide. */
  readonly suggestions: readonly CreatorSuggestion[];
}

const done = (ticks: readonly CreatorTick[], taskId: string, day: string): boolean =>
  ticks.some((tick) => tick.taskId === taskId && tick.day === day);

/** Whether a task is due on one of her days: its day, the day it starts, or one of its weekdays. */
export function dueOn(task: CreatorTask, day: string, zone: string): boolean {
  if (task.when.kind === 'day') return task.when.day === day;
  if (task.when.kind === 'timed') return dayOf(task.when.startsAt, zone) === day;
  return task.when.weekdays.includes(weekdayOf(day));
}

/** Whether a range of instants started on a day before `day` and is still running when `day` begins, in her zone. */
function carriedInto(startsAt: string, endsAt: string, day: string, zone: string): boolean {
  return dayOf(startsAt, zone) < day && Date.parse(endsAt) > zonedInstant(day, 0, zone).getTime();
}

/** Minutes of `instant` from the midnight that starts `day`, in her zone: past 1440 when it is the next day. */
function minutesFrom(day: string, instant: string, zone: string): number {
  const at = dayOf(instant, zone);
  let offset = 0;
  for (let next = day; next < at && offset < 2 * MINUTES_PER_DAY; next = addDays(next, 1))
    offset += MINUTES_PER_DAY;
  return offset + minuteOf(instant, zone);
}

/**
 * Her dispos on a day: each weekly one on its weekday (an end at or before its start is the next day's), each once;
 * and the end of one that started the day before and passes midnight, from 0 h (CREA-02).
 */
export function windowsOn(
  availabilities: readonly AvailabilityView[],
  day: string,
  zone: string,
): DayWindow[] {
  const windows: DayWindow[] = [];
  const weekday = weekdayOf(day);
  const dayBefore = weekdayOf(addDays(day, -1));
  for (const { id, when } of availabilities) {
    if (when.kind === 'weekly') {
      const overnight = when.endMinute <= when.startMinute;
      if (when.weekday === weekday)
        windows.push({
          id,
          start: when.startMinute,
          end: overnight ? when.endMinute + MINUTES_PER_DAY : when.endMinute,
        });
      if (overnight && when.weekday === dayBefore && when.endMinute > 0)
        windows.push({ id: `${id}:carried`, start: 0, end: when.endMinute });
    } else if (dayOf(when.startsAt, zone) === day) {
      windows.push({ id, start: minuteOf(when.startsAt, zone), end: minutesFrom(day, when.endsAt, zone) });
    } else if (carriedInto(when.startsAt, when.endsAt, day, zone)) {
      windows.push({ id: `${id}:carried`, start: 0, end: minutesFrom(day, when.endsAt, zone) });
    }
  }
  return windows.sort((a, b) => a.start - b.start);
}

const byEssentialThenTitle = (a: DayTask, b: DayTask): number =>
  Number(b.task.essential) - Number(a.task.essential) || a.task.title.localeCompare(b.task.title, 'fr');

/** Whether a suggestion is dated on a day (an undated one waits in « Ma semaine »). */
export function suggestedOn(suggestion: CreatorSuggestion, day: string, zone: string): boolean {
  const { when } = suggestion;
  if (when === null) return false;
  if (when.kind === 'day') return when.day === day;
  if (when.kind === 'timed') return dayOf(when.startsAt, zone) === day;
  return (
    when.weekdays.includes(weekdayOf(day)) && suggestion.week <= day && day <= addDays(suggestion.week, 6)
  );
}

export function planOf(agenda: CreatorAgenda, day: string): DayPlan {
  const zone = agenda.timeZone;
  const todo: DayTask[] = [];
  const timed: TimedTask[] = [];
  for (const task of agenda.tasks) {
    const { when } = task;
    if (when.kind === 'timed') {
      const carried = carriedInto(when.startsAt, when.endsAt, day, zone);
      if (!carried && !dueOn(task, day, zone)) continue;
      const startDay = dayOf(when.startsAt, zone);
      timed.push({
        task,
        done: done(agenda.ticks, task.id, startDay),
        start: carried ? 0 : minuteOf(when.startsAt, zone),
        end: minutesFrom(day, when.endsAt, zone),
        day: startDay,
        carried,
        length: Date.parse(when.endsAt) - Date.parse(when.startsAt),
      });
    } else if (dueOn(task, day, zone)) todo.push({ task, done: done(agenda.ticks, task.id, day) });
  }
  return {
    day,
    todo: todo.sort(byEssentialThenTitle),
    timed: timed.sort((a, b) => a.start - b.start || a.end - b.end),
    windows: windowsOn(agenda.availabilities, day, zone),
    suggestions: agenda.suggestions.filter((suggestion) => suggestedOn(suggestion, day, zone)),
  };
}

/** Her timed tasks that start on the day: the ones it counts (one carried from the day before counts there). */
export const ownTimed = (plan: DayPlan): readonly TimedTask[] => plan.timed.filter((item) => !item.carried);

/** What is done of her day, timed tasks included: each is a thing to do. */
export function progressOf(plan: DayPlan): { readonly done: number; readonly total: number } {
  const all = [...plan.todo, ...ownTimed(plan)];
  return { done: all.filter((item) => item.done).length, total: all.length };
}

/**
 * The task to start with (CREA-21): a task of the day not done, an essential one first; else, today, a timed task
 * whose time is over and that she has not ticked, « en retard ». Never a timed task still to come: « Ensuite » says it.
 * `now` is `null` on another day than today.
 */
export function firstOf(
  plan: DayPlan,
  now: number | null = null,
): { readonly task: CreatorTask; readonly late: boolean } | null {
  const left = plan.todo.filter((item) => !item.done);
  const ofDay = left.find((item) => item.task.essential) ?? left[0];
  if (ofDay !== undefined) return { task: ofDay.task, late: false };
  if (now === null) return null;
  const late = ownTimed(plan).find((item) => !item.done && item.end <= now);
  return late === undefined ? null : { task: late.task, late: true };
}

export type Moment =
  | { readonly kind: 'live'; readonly task: CreatorTask; readonly left: number }
  | { readonly kind: 'next'; readonly task: CreatorTask; readonly at: number; readonly in: number }
  | { readonly kind: 'none' };

/** « En cours » or « Ensuite » on her day, from the minute it is now. */
export function momentOf(plan: DayPlan, now: number): Moment {
  const live = plan.timed.find((item) => item.start <= now && now < item.end);
  if (live !== undefined) return { kind: 'live', task: live.task, left: live.end - now };
  const next = plan.timed.find((item) => item.start > now);
  return next === undefined
    ? { kind: 'none' }
    : { kind: 'next', task: next.task, at: next.start, in: next.start - now };
}

/** An agency's suggestion at an hour of her day, in minutes from her midnight. */
export interface ProposedAt {
  readonly suggestion: CreatorSuggestion;
  readonly start: number;
  readonly end: number;
}

export type ProgramRow =
  | { readonly kind: 'task'; readonly item: TimedTask }
  | { readonly kind: 'proposed'; readonly at: ProposedAt }
  | { readonly kind: 'free'; readonly start: number; readonly end: number; readonly open: boolean }
  | { readonly kind: 'now'; readonly at: number };

/** The program starts at 8 h at the latest, and ends at midnight. */
const PROGRAM_START = 8 * 60;
/** A free time shorter than half an hour is not worth a row. */
const SHORTEST_FREE = 30;

/**
 * Her program of the day, in order: her timed tasks, the agency's suggestions at their hour (dashed, to decide, CREA-22)
 * and the free times between them (« Libre », to touch to create a task there), each saying whether it is open to the
 * agency. Today, the past free times are left out and a line marks now. `now` is `null` on another day.
 */
export function programOf(
  plan: DayPlan,
  now: number | null,
  proposed: readonly ProposedAt[] = [],
): ProgramRow[] {
  const rows: ProgramRow[] = [];
  const free = (from: number, to: number): void => {
    const start = now !== null && from < now ? Math.ceil(now / 15) * 15 : from;
    if (to - start < SHORTEST_FREE) return;
    rows.push({
      kind: 'free',
      start,
      end: to,
      open: plan.windows.some((window) => window.start < to && window.end > start),
    });
  };
  const placed = [
    ...plan.timed.map((item) => ({ start: item.start, end: item.end, row: { kind: 'task', item } as const })),
    ...proposed.map((at) => ({ start: at.start, end: at.end, row: { kind: 'proposed', at } as const })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  let cursor = Math.min(PROGRAM_START, ...placed.map((one) => one.start));
  for (const one of placed) {
    if (one.start > cursor) free(cursor, one.start);
    rows.push(one.row);
    cursor = Math.max(cursor, one.end);
  }
  free(cursor, MINUTES_PER_DAY);
  const startOf = (row: ProgramRow): number =>
    row.kind === 'task'
      ? row.item.start
      : row.kind === 'proposed'
        ? row.at.start
        : row.kind === 'free'
          ? row.start
          : 0;
  if (now !== null && !plan.timed.some((item) => item.start <= now && now < item.end)) {
    const at = rows.findIndex((row) => startOf(row) >= now);
    rows.splice(at < 0 ? rows.length : at, 0, { kind: 'now', at: now });
  }
  return rows;
}

/** Her suggestions that found no room: she places them herself. */
export const undatedOf = (agenda: CreatorAgenda): CreatorSuggestion[] =>
  agenda.suggestions.filter((suggestion) => suggestion.when === null);
