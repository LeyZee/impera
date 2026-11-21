import { payPeriodAt } from '@impera/contracts';

/** The planning's grid zone in the tests, and its calendar (never a change-of-time hour in the minutes used). */
export const PARIS = 'Europe/Paris';

const MINUTE = 60_000;

/** The grid's day (Paris), shifted by `days`. */
export function parisDay(days = 0): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: PARIS }).format(new Date());
  const day = new Date(`${today}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar day: Monday 1 … Sunday 7. */
export const weekdayOf = (day: string): number => ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** The instant of a wall-clock minute in Paris on that day. */
export function parisInstant(day: string, minute: number): Date {
  const guess = new Date(`${day}T00:00:00Z`).getTime() + minute * MINUTE;
  const wall = new Intl.DateTimeFormat('en-CA', {
    timeZone: PARIS,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(guess);
  const [date = '', time = ''] = wall.split(', ');
  const offset = new Date(`${date}T${time}:00Z`).getTime() - guess;
  return new Date(guess - offset);
}

/** An instant as the routes take it, without milliseconds. */
export const iso = (at: Date): string => at.toISOString().replace('.000Z', 'Z');

/** This instant's midnight in Paris, in ms (the hours of a change of time are past at 3h, never in the first minute). */
function parisMidnight(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: PARIS,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((one) => one.type === type)?.value ?? 0);
  const since = ((part('hour') * 60 + part('minute')) * 60 + part('second')) * 1000 + at.getMilliseconds();
  return at.getTime() - since;
}

/**
 * A minute ago, or a second after midnight when `at` is in the first minute of its day in Paris: an instant of today
 * (and of the running fortnight, on a 1st or a 16th) for a route that reads the real clock.
 */
export const aMinuteAgoToday = (at: Date = new Date()): Date =>
  new Date(Math.max(at.getTime() - MINUTE, parisMidnight(at) + 1000));

/**
 * 00:00:30 in Paris on the first day of the fortnight running at `at`: the first instant of a 1st or a 16th, a clock
 * for tests that the turn of a fortnight must not break.
 */
export const fortnightDawn = (at: Date = new Date()): Date =>
  new Date(parisInstant(payPeriodAt(at, PARIS), 0).getTime() + 30_000);
