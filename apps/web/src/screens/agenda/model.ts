import type {
  AvailabilityView,
  CreatorAgenda,
  CreatorSuggestion,
  CreatorTask,
  CreatorTick,
} from '@impera/contracts';

import { addDays, dayOf, minuteOf, MINUTES_PER_DAY, weekdayOf } from '@/scheduling/time';

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

/** A timed task on one of her days, in minutes from her midnight (the end may pass 1440: it ends the next day). */
export interface TimedTask extends DayTask {
  readonly start: number;
  readonly end: number;
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

/** Minutes of `instant` from the midnight that starts `day`, in her zone: past 1440 when it is the next day. */
function minutesFrom(day: string, instant: string, zone: string): number {
  const at = dayOf(instant, zone);
  let offset = 0;
  for (let next = day; next < at && offset < 2 * MINUTES_PER_DAY; next = addDays(next, 1))
    offset += MINUTES_PER_DAY;
  return offset + minuteOf(instant, zone);
}

/** Her dispos on a day: each weekly one on its weekday (an end at or before its start is the next day's), each once. */
export function windowsOn(
  availabilities: readonly AvailabilityView[],
  day: string,
  zone: string,
): DayWindow[] {
  const windows: DayWindow[] = [];
  for (const { id, when } of availabilities) {
    if (when.kind === 'weekly') {
      if (when.weekday !== weekdayOf(day)) continue;
      const end = when.endMinute <= when.startMinute ? when.endMinute + MINUTES_PER_DAY : when.endMinute;
      windows.push({ id, start: when.startMinute, end });
    } else if (dayOf(when.startsAt, zone) === day) {
      windows.push({ id, start: minuteOf(when.startsAt, zone), end: minutesFrom(day, when.endsAt, zone) });
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
    if (!dueOn(task, day, zone)) continue;
    const item = { task, done: done(agenda.ticks, task.id, day) };
    if (task.when.kind === 'timed')
      timed.push({
        ...item,
        start: minuteOf(task.when.startsAt, zone),
        end: minutesFrom(day, task.when.endsAt, zone),
      });
    else todo.push(item);
  }
  return {
    day,
    todo: todo.sort(byEssentialThenTitle),
    timed: timed.sort((a, b) => a.start - b.start || a.end - b.end),
    windows: windowsOn(agenda.availabilities, day, zone),
    suggestions: agenda.suggestions.filter((suggestion) => suggestedOn(suggestion, day, zone)),
  };
}

/** What is done of her day, timed tasks included: each is a thing to do. */
export function progressOf(plan: DayPlan): { readonly done: number; readonly total: number } {
  const all = [...plan.todo, ...plan.timed];
  return { done: all.filter((item) => item.done).length, total: all.length };
}

/** The task to start with: an essential one first, then the first one left. `null` when all is done. */
export function firstOf(plan: DayPlan): CreatorTask | null {
  const left = [...plan.todo, ...plan.timed].filter((item) => !item.done);
  return (left.find((item) => item.task.essential) ?? left[0])?.task ?? null;
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

export type ProgramRow =
  | { readonly kind: 'task'; readonly item: TimedTask }
  | { readonly kind: 'free'; readonly start: number; readonly end: number; readonly open: boolean }
  | { readonly kind: 'now'; readonly at: number };

/** The program starts at 8 h at the latest, and ends at midnight. */
const PROGRAM_START = 8 * 60;
/** A free time shorter than half an hour is not worth a row. */
const SHORTEST_FREE = 30;

/**
 * Her program of the day, in order: her timed tasks and the free times between them (« Libre », to touch to create a
 * task there), each saying whether it is open to the agency. Today, the past free times are left out and a line marks
 * now. `now` is `null` on another day.
 */
export function programOf(plan: DayPlan, now: number | null): ProgramRow[] {
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
  let cursor = Math.min(PROGRAM_START, ...plan.timed.map((item) => item.start));
  for (const item of plan.timed) {
    if (item.start > cursor) free(cursor, item.start);
    rows.push({ kind: 'task', item });
    cursor = Math.max(cursor, item.end);
  }
  free(cursor, MINUTES_PER_DAY);
  if (now !== null && !plan.timed.some((item) => item.start <= now && now < item.end)) {
    const at = rows.findIndex(
      (row) => (row.kind === 'task' ? row.item.start : row.kind === 'free' ? row.start : 0) >= now,
    );
    rows.splice(at < 0 ? rows.length : at, 0, { kind: 'now', at: now });
  }
  return rows;
}

/** Her suggestions that found no room: she places them herself. */
export const undatedOf = (agenda: CreatorAgenda): CreatorSuggestion[] =>
  agenda.suggestions.filter((suggestion) => suggestion.when === null);
