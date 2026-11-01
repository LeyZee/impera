import { z } from 'zod';

/**
 * Pay periods (ADR 0023 § Paie): fortnights, the 1st to the 15th and the 16th to the end of the month, in the agency's
 * zone (`SchedulingSettings.timeZone`, Europe/Paris by default). A period is named by its first day, `YYYY-MM-01` or
 * `YYYY-MM-16`, which sorts like the periods. A shift belongs to the period it starts in, read in that zone when its
 * report is made, and the report keeps it: a later change of zone never moves a period already written.
 */
export const PayPeriodSchema = z.iso
  .date()
  .refine((day) => day.endsWith('-01') || day.endsWith('-16'), 'Une quinzaine commence le 1er ou le 16')
  .brand<'PayPeriod'>();
export type PayPeriod = z.infer<typeof PayPeriodSchema>;

function dayParts(day: string): { year: number; month: number; date: number } {
  const [year = Number.NaN, month = Number.NaN, date = Number.NaN] = day.split('-').map(Number);
  return { year, month, date };
}

const pad = (value: number): string => String(value).padStart(2, '0');

function periodAt(year: number, month: number, second: boolean): PayPeriod {
  return PayPeriodSchema.parse(`${String(year).padStart(4, '0')}-${pad(month)}-${second ? '16' : '01'}`);
}

/**
 * The period a calendar day falls in: the 15th is in the first fortnight, the 16th in the second. `day` is a
 * well-formed `YYYY-MM-DD`, a day that exists: anything else throws.
 */
export function payPeriodOfDay(day: string): PayPeriod {
  const { year, month, date } = dayParts(z.iso.date().parse(day));
  return periodAt(year, month, date >= 16);
}

/** The last day of a period: the 15th, or the last day of the month (28 to 31). */
export function payPeriodLastDay(period: PayPeriod): string {
  const { year, month, date } = dayParts(period);
  if (date === 1) return `${period.slice(0, 8)}15`;
  return `${period.slice(0, 8)}${pad(new Date(Date.UTC(year, month, 0)).getUTCDate())}`;
}

/** The period after `period`. */
export function nextPayPeriod(period: PayPeriod): PayPeriod {
  const { year, month, date } = dayParts(period);
  if (date === 1) return periodAt(year, month, true);
  return month === 12 ? periodAt(year + 1, 1, false) : periodAt(year, month + 1, false);
}

/** The period before `period`. */
export function previousPayPeriod(period: PayPeriod): PayPeriod {
  const { year, month, date } = dayParts(period);
  if (date === 16) return periodAt(year, month, false);
  return month === 1 ? periodAt(year - 1, 12, true) : periodAt(year, month - 1, true);
}

/** The calendar day it is at `at` in `timeZone`, `YYYY-MM-DD`: today in the agency's zone, for pay. */
export function calendarDayAt(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** The period the instant `at` falls in, in the agency's zone `timeZone`: today's period, for pay's jobs. */
export function payPeriodAt(at: Date, timeZone: string): PayPeriod {
  return payPeriodOfDay(calendarDayAt(at, timeZone));
}

/**
 * PAIE-22: a pay rule of the team (individual tiers, the payout minimum) starts with a period that has not begun, as a
 * commission rate or a role does: its first day is `today` at the earliest. A chatter never sees a rule change under a
 * fortnight already worked. `today` is the agency's calendar day (`calendarDayAt`), never the client's.
 */
export function payPeriodNotBegun(period: PayPeriod, today: string): boolean {
  return period >= today;
}

/** PAIE-22: the collective goal of a period may still be set up to this day of the period, the 3rd (or the 18th). */
export const COLLECTIVE_GOAL_LAST_DAY = 3;

/** The last day the goal of `period` may be set: its 3rd day, the 3rd or the 18th. */
export function collectiveGoalLastDay(period: PayPeriod): string {
  const first = Number(period.slice(8, 10));
  return `${period.slice(0, 8)}${pad(first + COLLECTIVE_GOAL_LAST_DAY - 1)}`;
}

/**
 * Where the goal of `period` stands on `today` (PAIE-22): `ahead` before its first day, `started` from its first to its
 * 3rd day (allowed, with a warning: the team has begun working on it), `closed` after.
 */
export function collectiveGoalWindow(period: PayPeriod, today: string): 'ahead' | 'started' | 'closed' {
  if (today < period) return 'ahead';
  return today <= collectiveGoalLastDay(period) ? 'started' : 'closed';
}
