import {
  agencyRateFor,
  type AgencyShareAlert,
  type CreatorAgencyRate,
  type CreatorAgencyRateList,
  type ObservedAgencyShare,
  type ObservedAgencyWindow,
} from '@impera/contracts';

import { platformName } from '@/scheduling/model';
import { fullDay, withFirstOfMonth } from '@/scheduling/time';

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

/** `2026-11-10` → « 10 novembre 2026 », `2026-10-01` → « 1er octobre 2026 »: as the rest of the sheet writes a day. */
export const dayLabel = (day: string): string => fullDay(day);

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

const DAY_OF_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'UTC' });
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
/** The day an alert was sent, on the reader's own clock. */
const DAY_MONTH_HERE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const atNoon = (day: string): Date => new Date(`${day}T12:00:00Z`);

/**
 * A fortnight read on the register, its year said by the screen's title: `2026-11-01` to `2026-11-15` → « du 1er au
 * 15 novembre », across two months « du 16 octobre au 2 novembre », and the first day of one, today, « aujourd’hui ».
 */
export function windowLabel(window: Pick<ObservedAgencyWindow, 'from' | 'to'>, today: string): string {
  const to = withFirstOfMonth(DAY_MONTH.formatToParts(atNoon(window.to)));
  if (window.from === window.to) return window.to === today ? 'aujourd’hui' : `le ${to}`;
  const sameMonth = window.from.slice(0, 7) === window.to.slice(0, 7);
  const from = withFirstOfMonth((sameMonth ? DAY_OF_MONTH : DAY_MONTH).formatToParts(atNoon(window.from)));
  return `du ${from} au ${to}`;
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
type AccountOf = Pick<ObservedAgencyShare, 'platform' | 'platformAccountId' | 'currency'>;

export function shareWhere(share: AccountOf, shares: readonly AccountOf[]): string | null {
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
 * The percentage a window was compared with, when one alone covers all its days, to name it beside a gap; `null` when
 * the window straddles a change, or starts before her first: the gap is then said without a figure.
 */
export function windowRate(
  list: Pick<CreatorAgencyRateList, 'rates'>,
  window: Pick<ObservedAgencyWindow, 'from' | 'to'>,
): number | null {
  const first = agencyRateFor(list.rates, window.from);
  const last = agencyRateFor(list.rates, window.to);
  return first !== null && first.id === last?.id ? first.agencyBps : null;
}

/** The words beside a share off her percentage: the percentage of its window when one alone covers it. */
export function gapText(
  list: Pick<CreatorAgencyRateList, 'rates'>,
  window: Pick<ObservedAgencyWindow, 'from' | 'to'>,
): string {
  const bps = windowRate(list, window);
  return bps === null ? 'écart avec le pourcentage réglé' : `écart avec les ${percentOf(bps)} réglés`;
}

/**
 * Her accounts whose share of the 30 days differs from her percentage by more than rounding explains, as the server
 * reads it by the rule of the gap alert (ADR 0054 § 2 and § 6): the screen compares nothing itself.
 */
export const sharesOffRate = (list: CreatorAgencyRateList): readonly ObservedAgencyShare[] =>
  list.observed.last30Days.shares.filter((share) => share.differsFromRate === true);

/**
 * The head of the sheet (ADR 0054 § 4 and § 6): the share read at the platform first, the percentage second and
 * optional; « à régler » only when nothing is linked nor set. `dot`: `warn` for a share off her percentage or for
 * « à régler », `ok` with a share or a percentage, `idle` for a linked account without a sale.
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
  const off = sharesOffRate(list);
  const [onlyOff] = off;
  if (onlyOff !== undefined) {
    const check = 'Vérifie le partage chez ' + at + ' ou règle un nouveau pourcentage ci-dessous.';
    // The percentage the 30 days were compared with, when one alone covers them; else the gap without a figure.
    const agreed = windowRate(list, list.observed.last30Days);
    if (single !== null && single.agencyBps !== null) {
      const set =
        agreed === null ? 'loin du pourcentage réglé sur ces jours' : `tu as réglé ${percentOf(agreed)}`;
      return {
        dot: 'warn',
        lead: `Écart : ${at} donne ${percentOf(single.agencyBps)} du net sur 30 jours, ${set}.`,
        then: check,
      };
    }
    const from = agreed === null ? 'du pourcentage réglé' : `des ${percentOf(agreed)} réglés`;
    return {
      dot: 'warn',
      lead: `Écart : ${off.length === 1 ? 'un compte s’écarte' : `${String(off.length)} comptes s’écartent`} ${from}, sur 30 jours (détail ci-dessous).`,
      then: check,
    };
  }
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

/**
 * An alert the automatic check published on a fortnight shown (PAY-04, ADR 0054 §§ 2 and 5), in words: dated, so that
 * a gap put right since is not read as present (relecture d'Équipe), then the fortnight,
 * the account when she has several (`shareWhere` on her shares and alerts), and what it found. The figures of a gap
 * are in the fortnight's line below; a change says both shares.
 */
export function alertText(alert: AgencyShareAlert, list: CreatorAgencyRateList): string {
  const { last30Days, fortnights } = list.observed;
  const accounts = [...[last30Days, ...fortnights].flatMap((window) => window.shares), ...list.alerts];
  const where = shareWhere(alert, accounts);
  const sent = withFirstOfMonth(DAY_MONTH_HERE.formatToParts(new Date(alert.at)));
  const fortnight = `Alerte du ${sent}, quinzaine ${windowLabel(alert, list.today)}${where === null ? '' : `, ${where}`}`;
  return alert.kind === 'mismatch'
    ? `${fortnight} : sa part lue s’écartait du pourcentage réglé.`
    : `${fortnight} : la part de l’agence est passée de ${percentOf(alert.previousAgencyBps)} à ${percentOf(alert.agencyBps)}.`;
}
