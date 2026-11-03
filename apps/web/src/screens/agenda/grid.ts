import type { CreatorAgenda, CreatorSuggestion, CreatorTask, CreatorTaskWhen } from '@impera/contracts';

import { spanOf } from './draft';
import { planOf, type DayPlan, type TimedTask } from './model';

import { addDays, dayOf, minuteOf, mondayOf, MINUTES_PER_DAY } from '@/scheduling/time';

/*
 * Her Semaine and Mois on a computer (CR-05 b2), pure: the hours a week grid shows, side by side lanes for tasks that
 * overlap, the minute under the pointer snapped to a quarter, a move kept the length of the task, and the weeks of a
 * month. Read in her zone, the server's.
 */

/** A quarter of an hour: what a drag snaps to. */
export const SNAP_MINUTES = 15;
/** The shortest task a drag on a free time creates. */
export const SHORTEST_MINUTES = 30;
/** The grid starts at 7 h unless something starts earlier; it ends at midnight. */
const FIRST_HOUR = 7;
const LAST_HOUR = 24;

export const snap = (minute: number): number => Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;

/** The hours a week grid shows: from 7 h, or the earliest hour a task of the week starts at, to midnight. */
export function hoursOf(plans: readonly DayPlan[]): { readonly first: number; readonly last: number } {
  const earliest = Math.min(
    FIRST_HOUR * 60,
    ...plans.flatMap((plan) => plan.timed.map((item) => item.start)),
    ...plans.flatMap((plan) => plan.windows.map((window) => window.start)),
  );
  return { first: Math.floor(earliest / 60), last: LAST_HOUR };
}

/** Something with a start and an end on a day, in minutes from her midnight. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** Side by side lanes: each item gets its lane and the number of lanes of the group it overlaps in. */
export function lanesOf<T extends Span>(items: readonly T[]): (T & { lane: number; lanes: number })[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const placed: (T & { lane: number; lanes: number })[] = [];
  let group: (T & { lane: number; lanes: number })[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = (): void => {
    const lanes = Math.max(0, ...group.map((item) => item.lane)) + 1;
    for (const item of group) item.lanes = lanes;
    group = [];
    ends = [];
  };
  for (const item of sorted) {
    if (group.length > 0 && item.start >= groupEnd) close();
    let lane = ends.findIndex((end) => end <= item.start);
    if (lane < 0) {
      lane = ends.length;
      ends.push(item.end);
    } else ends[lane] = item.end;
    const one = { ...item, lane, lanes: 1 };
    group.push(one);
    placed.push(one);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length > 0) close();
  return placed;
}

/** The minute of her day at a height of a column, snapped to a quarter and kept inside the grid. */
export function minuteAt(
  y: number,
  column: { readonly top: number; readonly height: number },
  hours: { readonly first: number; readonly last: number },
): number {
  const span = (hours.last - hours.first) * 60;
  const share = column.height <= 0 ? 0 : (y - column.top) / column.height;
  return Math.max(hours.first * 60, Math.min(hours.last * 60, snap(hours.first * 60 + share * span)));
}

/** The task a drag over a free time creates: from where it started to where it is, 30 minutes at least. */
export function createdSpan(from: number, to: number, hours: { readonly last: number }): Span {
  const start = Math.min(from, to);
  const end = Math.max(from, to, start + SHORTEST_MINUTES);
  return end > hours.last * 60
    ? { start: hours.last * 60 - SHORTEST_MINUTES, end: hours.last * 60 }
    : { start, end };
}

/** Where a timed task dragged lands: its length kept, inside the grid. */
export function movedSpan(
  item: Span,
  start: number,
  hours: { readonly first: number; readonly last: number },
): Span {
  const length = item.end - item.start;
  const at = Math.max(hours.first * 60, Math.min(hours.last * 60 - length, start));
  return { start: at, end: at + length };
}

/** The `when` of a timed task moved to a day and a start, its length kept; `null` when nothing changed. */
export function movedWhen(task: CreatorTask, day: string, span: Span, zone: string): CreatorTaskWhen | null {
  if (task.when.kind !== 'timed') return null;
  if (dayOf(task.when.startsAt, zone) === day && minuteOf(task.when.startsAt, zone) === span.start)
    return null;
  return { kind: 'timed', ...spanOf(day, span.start, span.end % MINUTES_PER_DAY, zone) };
}

/** A timed suggestion on a day, placed in the grid like a task (dashed). */
export interface TimedSuggestion extends Span {
  readonly suggestion: CreatorSuggestion;
}

export function timedSuggestionsOf(plan: DayPlan, zone: string): TimedSuggestion[] {
  const timed: TimedSuggestion[] = [];
  for (const suggestion of plan.suggestions) {
    const { when } = suggestion;
    if (when?.kind !== 'timed') continue;
    const start = minuteOf(when.startsAt, zone);
    const length = Math.round((Date.parse(when.endsAt) - Date.parse(when.startsAt)) / 60_000);
    timed.push({ suggestion, start, end: start + length });
  }
  return timed;
}

/** Whether a timed task of a day is over: before today, or ended today before now. */
export const isOver = (item: TimedTask, day: string, today: string, nowMinute: number): boolean =>
  day < today || (day === today && item.end <= nowMinute);

/* ---- Mois ---- */

/** The first day of the month of `day`, moved by `count` months. */
export function monthOf(day: string, count = 0): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7)) - 1 + count;
  const first = new Date(Date.UTC(year, month, 1));
  return first.toISOString().slice(0, 10);
}

/** The days a month grid shows: from the Monday of its first week to the Sunday of its last, five or six weeks. */
export function monthDays(day: string): string[] {
  const first = monthOf(day);
  const next = monthOf(day, 1);
  const start = mondayOf(first);
  const days: string[] = [];
  for (let one = start; one < next || days.length % 7 !== 0; one = addDays(one, 1)) days.push(one);
  return days;
}

/** The range of days the month grid reads: 35 or 42 days, within the 42 the server answers. */
export function monthRange(day: string): { readonly from: string; readonly to: string } {
  const days = monthDays(day);
  return { from: days[0] ?? day, to: days.at(-1) ?? day };
}

/** A line of a month cell: a timed task with its hour, a task of the day, or a suggestion (dashed). */
export interface MonthLine {
  readonly key: string;
  readonly title: string;
  readonly category: CreatorTask['category'];
  readonly start: number | null;
  readonly done: boolean;
  readonly proposed: boolean;
}

/** What a month cell lists, hours first then the tasks of the day; her routine stays in Jour. */
export function monthLinesOf(agenda: CreatorAgenda, day: string): MonthLine[] {
  const plan = planOf(agenda, day);
  const zone = agenda.timeZone;
  const timed: MonthLine[] = plan.timed.map((item) => ({
    key: item.task.id,
    title: item.task.title,
    category: item.task.category,
    start: item.start,
    done: item.done,
    proposed: false,
  }));
  const proposed: MonthLine[] = plan.suggestions.map((suggestion) => ({
    key: suggestion.id,
    title: suggestion.title,
    category: suggestion.category,
    start: suggestion.when?.kind === 'timed' ? minuteOf(suggestion.when.startsAt, zone) : null,
    done: false,
    proposed: true,
  }));
  const ofDay: MonthLine[] = plan.todo
    .filter((item) => item.task.when.kind === 'day')
    .map((item) => ({
      key: item.task.id,
      title: item.task.title,
      category: item.task.category,
      start: null,
      done: item.done,
      proposed: false,
    }));
  return [...timed, ...proposed].sort((a, b) => (a.start ?? -1) - (b.start ?? -1)).concat(ofDay);
}

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** « Novembre 2026 ». */
export function monthLabel(day: string): string {
  const label = MONTH.format(new Date(`${monthOf(day)}T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
