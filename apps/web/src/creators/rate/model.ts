import type {
  CreatorAgencyRate,
  CreatorAgencyRateList,
  ObservedAgencyShare,
  ObservedAgencyWindow,
} from '@impera/contracts';

import { platformName } from '@/scheduling/model';
import { amountOf } from '@/screens/sales/view';

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

/** `2026-11-01` to `2026-11-14` → « du 01/11 au 14/11 »: a fortnight, its year said by the screen's title. */
export function windowLabel(window: Pick<ObservedAgencyWindow, 'from' | 'to'>): string {
  const short = (day: string): string => dayLabel(day).slice(0, 5);
  return `du ${short(window.from)} au ${short(window.to)}`;
}

/**
 * Where a share was read: « Reveal », and its currency when it is not the euro (« Reveal, en USD »), its account's
 * place when she has several on that platform (« Reveal 2 »), in the order the server gives.
 */
export function shareWhere(share: ObservedAgencyShare, shares: readonly ObservedAgencyShare[]): string {
  const accounts = [
    ...new Set(shares.filter((one) => one.platform === share.platform).map((one) => one.platformAccountId)),
  ];
  const place = accounts.length > 1 ? ` ${String(accounts.indexOf(share.platformAccountId) + 1)}` : '';
  const currency = share.currency === 'EUR' ? '' : `, en ${share.currency}`;
  return `${platformName(share.platform)}${place}${currency}`;
}

/**
 * The agency's share as the platform reads it, in words (ADR 0054 § 4): « 37,5 % du net » and the two sums it
 * comes from, never computed again; without a net to read it on, said so.
 */
export function shareText(share: ObservedAgencyShare): { readonly value: string; readonly detail: string } {
  if (share.agencyBps === null) {
    return { value: '—', detail: 'remboursements plus lourds que les ventes, aucune part à lire' };
  }
  return {
    value: `${percentOf(share.agencyBps)} du net`,
    detail: `${amountOf(share.agencyMinor, share.currency)} sur ${amountOf(share.netMinor, share.currency)}`,
  };
}

/** The share of the 30 days when she sells on one account in one currency: the head says it in one sentence. */
export const singleShare = (list: CreatorAgencyRateList): ObservedAgencyShare | null => {
  const shares = list.observed.last30Days.shares;
  const [only] = shares;
  return shares.length === 1 && only !== undefined && only.agencyBps !== null ? only : null;
};
