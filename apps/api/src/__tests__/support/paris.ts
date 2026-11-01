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
