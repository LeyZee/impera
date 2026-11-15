import type {
  CreatorAgencyRate,
  CreatorAgencyRateList,
  ObservedAgencyShare,
  ObservedAgencyWindow,
} from '@impera/contracts';

import { platformName } from '@/scheduling/model';

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

/** The platform the shares were read on: « Reveal » when all are, the only sales feed today, else « la plateforme ». */
export function readAt(shares: readonly ObservedAgencyShare[]): string {
  const platforms = new Set(shares.map((share) => share.platform));
  const [only] = platforms;
  return platforms.size <= 1 ? platformName(only ?? 'reveal') : 'la plateforme';
}

/**
 * Which of her accounts a share is, when it needs saying: its platform when she sells on several, its place when she
 * has several accounts (« Reveal 2 »), its currency when it is not the euro (« en USD »); `null` for her one account in
 * euros, which the card's title already names.
 */
export function shareWhere(
  share: ObservedAgencyShare,
  shares: readonly ObservedAgencyShare[],
): string | null {
  const platforms = new Set(shares.map((one) => one.platform));
  const accounts = [
    ...new Set(shares.filter((one) => one.platform === share.platform).map((one) => one.platformAccountId)),
  ];
  const parts = [
    platforms.size > 1 || accounts.length > 1 ? platformName(share.platform) : '',
    accounts.length > 1 ? String(accounts.indexOf(share.platformAccountId) + 1) : '',
  ].filter((part) => part !== '');
  const name = parts.join(' ');
  const currency = share.currency === 'EUR' ? '' : `en ${share.currency}`;
  const where = [name, currency].filter((part) => part !== '').join(', ');
  return where === '' ? null : where;
}

/** An amount of the card, always with its cents, so that its figures line up (« 1 442,00 € »). */
function cents(minor: number, currency: ObservedAgencyShare['currency']): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

/**
 * The agency's share as the platform reads it, in words (ADR 0054 § 4): « 37,5 % du net » and the two sums it comes
 * from, named, never computed again; without a net to read it on, said so.
 */
export function shareText(share: ObservedAgencyShare): { readonly value: string; readonly detail: string } {
  if (share.agencyBps === null) {
    return { value: '—', detail: 'remboursements plus lourds que les ventes, aucune part à lire' };
  }
  return {
    value: `${percentOf(share.agencyBps)} du net`,
    detail: `${cents(share.agencyMinor, share.currency)} pour l’agence sur ${cents(share.netMinor, share.currency)} nets`,
  };
}

/** The share of the 30 days when she sells on one account in one currency: the head says it in one sentence. */
export const singleShare = (list: CreatorAgencyRateList): ObservedAgencyShare | null => {
  const shares = list.observed.last30Days.shares;
  const [only] = shares;
  return shares.length === 1 && only !== undefined && only.agencyBps !== null ? only : null;
};

/**
 * The head of the sheet (ADR 0054 § 4 and § 6): the share read at the platform first, the percentage second and
 * optional; « à régler » only when nothing is linked nor set. `dot`: `ok` with a share or a percentage, `idle` for a
 * linked account without a sale, `warn` for « à régler ».
 */
export function sheetHead(
  list: CreatorAgencyRateList,
  creatorName: string,
): { readonly dot: 'ok' | 'idle' | 'warn'; readonly lead: string; readonly then: string | null } {
  const { current } = list;
  const shares = list.observed.last30Days.shares;
  const at = readAt(shares);
  const single = singleShare(list);
  const rate =
    current === null ? null : `${percentOf(current.agencyBps)} depuis le ${dayLabel(current.fromDay)}`;
  const second = rate === null ? 'Le pourcentage est facultatif.' : `Pourcentage réglé : ${rate}.`;
  if (single !== null) {
    return { dot: 'ok', lead: `Lue chez ${at} : ${shareText(single).value} sur 30 jours.`, then: second };
  }
  if (shares.length > 0) {
    return { dot: 'ok', lead: `Lue chez ${at} sur 30 jours, compte par compte ci-dessous.`, then: second };
  }
  if (list.observed.linked) {
    return {
      dot: rate === null ? 'idle' : 'ok',
      lead: `Aucune vente lue chez ${at} sur 30 jours.`,
      then: second,
    };
  }
  if (current !== null) {
    return {
      dot: 'ok',
      lead: `${percentOf(current.agencyBps)} pour l’agence aujourd’hui, depuis le ${dayLabel(current.fromDay)}.`,
      then: null,
    };
  }
  return {
    dot: 'warn',
    lead: `À régler : relie Reveal ou règle un pourcentage pour ${creatorName}.`,
    then: null,
  };
}
