import type { CreatorAgencyRate, CreatorAgencyRateList } from '@impera/contracts';

/**
 * Créatrices › Pourcentage (CR-04), pure: what the owner types read as whole basis points, and how a percentage and its
 * day are said. No amount of money is computed here: the server picks the percentage in force and says « à régler ».
 */

/** « 35 », « 35,5 » or « 35.25 »: a percentage from 0 to 100, two decimals at most. */
const PERCENT = /^(\d{1,3})(?:[.,](\d{1,2}))?$/u;

/** What the owner typed as basis points (« 35,5 » → 3550), or `null` when it is not a percentage of 0 to 100. */
export function bpsOfPercent(text: string): number | null {
  const match = PERCENT.exec(text.trim().replace(/\s*%$/u, ''));
  if (match === null) return null;
  const [, whole = '', decimals = ''] = match;
  const bps = Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

const PERCENT_FORMAT = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** « 35 % », « 35,5 % »: the sign after a non-breaking space, as French writes it. */
export const percentOf = (bps: number): string => `${PERCENT_FORMAT.format(bps / 100)}\u00a0%`;

/** `2026-11-10` → « 10/11/2026 ». */
export function dayLabel(day: string): string {
  const [year = '', month = '', date = ''] = day.split('-');
  return `${date}/${month}/${year}`;
}

/** The day after `day` (`YYYY-MM-DD`), on the calendar, whatever the zone. */
export function nextDay(day: string): string {
  const at = new Date(`${day}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

/** The first day a new percentage may start: today for her first, tomorrow after (the server holds the same rule). */
export const earliestDay = (list: CreatorAgencyRateList): string =>
  list.rates.length === 0 ? list.today : nextDay(list.today);

/** Where a percentage of the list stands on `today`: in force, still to come, or replaced. */
export function standing(
  rate: CreatorAgencyRate,
  list: CreatorAgencyRateList,
): 'current' | 'coming' | 'past' {
  if (list.current?.id === rate.id) return 'current';
  return rate.fromDay > list.today ? 'coming' : 'past';
}

/** The sentence the owner confirms before sending: a percentage is never changed afterwards. */
export const confirmSentence = (bps: number, fromDay: string): string =>
  `${percentOf(bps)} pour l’agence à partir du ${dayLabel(fromDay)}.`;
