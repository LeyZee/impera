import { payPeriodLastDay, type ExchangeRate, type PayPeriod } from '@nirvana/contracts';

import { MissingExchangeRate } from './errors';
import { mulDivRound, RATE_SCALE } from './rounding';

/**
 * Pay's exchange rates (ADR 0033), their pure rules: the ECB's rate turned into pay's, how old a rate a closing may
 * freeze, and when a missing rate rings. The job that reads the ECB lives in `application/exchange-rates.ts` and
 * `infra/ecb.ts`.
 */

/** Where every rate pay writes comes from, as a statement copies it. */
export const ECB_SOURCE = 'BCE, taux de référence';

/** The longest normal gap between two ECB rates at a period's end: from the Thursday to Easter Monday. */
const RATE_MAX_AGE_DAYS = 4;

/**
 * More weekdays than this without a rate is a stopped job or an ECB out of reach, never a weekend nor a holiday: the
 * longest run of the ECB's closed weekdays is two (Good Friday and Easter Monday, or the 25th and 26th of December).
 */
const RATE_OVERDUE_AFTER_WEEKDAYS = 2;

/** The ECB's days are those of Frankfurt. */
const ECB_TIME_ZONE = 'Europe/Berlin';

const ECB_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: ECB_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DECIMAL = /^(\d{1,6})(?:\.(\d{1,8}))?$/;

/**
 * Euros for one unit of the currency, in millionths, from the ECB's units of the currency for one euro as it writes
 * them (`1.1188` → 893 815): computed on the decimal text, never on a float, rounded as all of pay.
 */
export function eurosPerUnitMicros(perEuro: string): number {
  const match = DECIMAL.exec(perEuro);
  if (match === null) throw new RangeError(`Not a decimal rate: ${perEuro}`);
  const [, whole = '', fraction = ''] = match;
  // At most 14 digits: a safe integer.
  const units = Number(whole + fraction);
  if (units === 0) throw new RangeError('A rate of zero');
  return mulDivRound(RATE_SCALE, 10 ** fraction.length, units);
}

/** Calendar days from `from` to `to`, two days of the agency's zone as written. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * A closing never freezes a rate more than `RATE_MAX_AGE_DAYS` before its period's last day: that is a stopped job,
 * not a weekend nor a holiday, and pay never guesses a rate (`exchange_rate_missing_conflict`).
 */
export function assertFreshRates(period: PayPeriod, rates: readonly ExchangeRate[]): void {
  const lastDay = payPeriodLastDay(period);
  for (const rate of rates) {
    if (daysBetween(rate.day, lastDay) > RATE_MAX_AGE_DAYS) throw new MissingExchangeRate(rate.currency);
  }
}

/** The ECB's day at `at`, written as its days are (`2026-10-29`). */
export function ecbDay(at: Date): string {
  return ECB_DAY.format(at);
}

/**
 * The weekdays strictly after `lastRateDay` and before `today`: the ECB days whose rate should be written by now.
 * Today does not count yet, since its rate comes in the afternoon.
 */
export function weekdaysWithoutRate(lastRateDay: string, today: string): number {
  let missing = 0;
  for (let gap = 1; gap < daysBetween(lastRateDay, today); gap += 1) {
    const weekday = new Date(Date.parse(`${lastRateDay}T00:00:00Z`) + gap * 86_400_000).getUTCDay();
    if (weekday !== 0 && weekday !== 6) missing += 1;
  }
  return missing;
}

/** A currency's last rate is overdue (`exchange_rate_overdue`) after more than two weekdays without one. */
export function isRateOverdue(lastRateDay: string, today: string): boolean {
  return weekdaysWithoutRate(lastRateDay, today) > RATE_OVERDUE_AFTER_WEEKDAYS;
}
