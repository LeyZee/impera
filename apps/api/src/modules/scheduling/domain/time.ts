/**
 * Calendar days and wall-clock time in a zone, pure (ADR 0011: instants in UTC, a zone only to read or to write
 * them). A calendar day is `YYYY-MM-DD`, which sorts like the date. Only the templates speak in wall-clock time.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function dayParts(day: string): { year: number; month: number; date: number } {
  const [year = Number.NaN, month = Number.NaN, date = Number.NaN] = day.split('-').map(Number);
  return { year, month, date };
}

/** The day `count` days after `day` (before, when negative). */
export function addDays(day: string, count: number): string {
  const { year, month, date } = dayParts(day);
  return new Date(Date.UTC(year, month - 1, date) + count * DAY_MS).toISOString().slice(0, 10);
}

/** The ISO weekday of a calendar day: 1 Monday … 7 Sunday. */
export function isoWeekday(day: string): number {
  const { year, month, date } = dayParts(day);
  return ((new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7) + 1;
}

/** The day it is at `at` in `timeZone`. */
export function calendarDayIn(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** How far `timeZone` is ahead of UTC at `at`, in minutes (Paris: 60 in winter, 120 in summer). */
export function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string): number => Number(parts.find((part) => part.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((wall - Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS) / MINUTE_MS);
}

/**
 * The instant a wall-clock time of `day` (`minute` after its midnight) names in `timeZone`. Two cases need a rule
 * (contract `scheduling.ts`): a time that falls in the spring gap does not exist, and becomes the first instant after
 * the gap (02:30 on the last Sunday of March in Paris is 03:00); a time that happens twice in the autumn becomes the
 * first of the two. A change of time never happens twice within two days, so the offsets a day before and a day
 * after are the only two candidates.
 */
export function wallClockToInstant(day: string, minute: number, timeZone: string): Date {
  const { year, month, date } = dayParts(day);
  const wall = Date.UTC(year, month - 1, date, 0, minute);
  const before = offsetMinutes(new Date(wall - DAY_MS), timeZone);
  const after = offsetMinutes(new Date(wall + DAY_MS), timeZone);
  const fits = [before, after]
    .map((offset) => wall - offset * MINUTE_MS)
    .filter((instant) => wall - offsetMinutes(new Date(instant), timeZone) * MINUTE_MS === instant)
    .sort((a, b) => a - b);
  const first = fits[0];
  if (first !== undefined) return new Date(first);
  // In the gap: the zone moves from `before` to `after` somewhere in between; find that minute.
  let low = wall - after * MINUTE_MS;
  let high = wall - before * MINUTE_MS;
  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / MINUTE_MS / 2) * MINUTE_MS;
    if (offsetMinutes(new Date(middle), timeZone) === after) high = middle;
    else low = middle;
  }
  return new Date(high);
}

/** Whether an instant falls on a minute: seconds and milliseconds at zero. */
export function onTheMinute(at: Date): boolean {
  return at.getTime() % MINUTE_MS === 0;
}

/** The minute `at` falls in: its seconds and milliseconds dropped. */
export function minuteOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / MINUTE_MS) * MINUTE_MS);
}

export function addMinutes(at: Date, minutes: number): Date {
  return new Date(at.getTime() + minutes * MINUTE_MS);
}
