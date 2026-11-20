import type { CreatorEarnings, CreatorEarningsLine, EarningsPeriod, SaleType } from '@impera/contracts';

import { amountOf } from './view';

import { addDays, longDay } from '@/scheduling/time';

/*
 * « Ta part » in words (CR-04): her part over a period, the period's name, and each sale. Only her part is ever
 * written: never what the fan paid, the platform's share, the agency's, nor who sold. Pure.
 */

export const PERIOD_LABELS: Readonly<Record<EarningsPeriod, string>> = {
  day: 'Jour',
  fortnight: 'Quinzaine',
  month: 'Mois',
};

/** What was sold, in her words. */
export const SALE_TYPE_WORDS: Readonly<Record<SaleType, string>> = {
  subscription: 'Abonnement',
  renewal: 'Réabonnement',
  ppv: 'Message débloqué',
  mass_dm: 'Message à tous',
  tip: 'Pourboire',
  payment_link: 'Lien de paiement',
  boudoir: 'Boudoir',
  paid_message: 'Message payant',
  other: 'Autre vente',
};

/** « 15 oct. »: the end of a fortnight, which never leaves its month. */
const DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** « Aujourd’hui », « Hier », « mardi 3 novembre »; « 1er – 15 novembre »; « novembre 2026 ». */
export function periodName(earnings: Pick<CreatorEarnings, 'period' | 'from' | 'to'>, today: string): string {
  switch (earnings.period) {
    case 'day':
      if (earnings.from === today) return 'Aujourd’hui';
      if (earnings.from === addDays(today, -1)) return 'Hier';
      return longDay(earnings.from);
    case 'fortnight':
      // « 1er – 15 oct. », « 16 – 31 oct. ».
      return `${earnings.from.endsWith('-01') ? '1er' : String(Number(earnings.from.slice(8)))} – ${DAY_MONTH.format(new Date(`${earnings.to}T00:00:00Z`))}`;
    case 'month':
      return MONTH.format(new Date(`${earnings.from}T00:00:00Z`));
  }
}

/** Her part, per currency: « 412,30 € », « 412,30 € et 20 $ »; « 0 € » over a period with nothing. */
export function partOf(earnings: Pick<CreatorEarnings, 'totals'>): string {
  if (earnings.totals.length === 0) return amountOf(0, 'EUR');
  return earnings.totals.map((total) => amountOf(total.creatorMinor, total.currency)).join(' et ');
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** « 12 ventes · 1 remboursement », `null` with none. */
export function countsOf(earnings: Pick<CreatorEarnings, 'totals'>): string | null {
  const sales = earnings.totals.reduce((sum, total) => sum + total.sales, 0);
  const refunds = earnings.totals.reduce((sum, total) => sum + total.refunds, 0);
  if (sales === 0 && refunds === 0) return null;
  const parts = [plural(sales, 'vente', 'ventes')];
  if (refunds > 0) parts.push(plural(refunds, 'remboursement', 'remboursements'));
  return parts.join(' · ');
}

/** A line's part, signed for a refund: « +12,50 € », « −12,50 € ». */
export const lineAmount = (line: CreatorEarningsLine): string =>
  `${line.event === 'refund' ? '−' : '+'}${amountOf(line.creatorMinor, line.currency)}`;

/** The day the period before or after starts from: the day before its first, the day after its last. */
export const stepDay = (earnings: Pick<CreatorEarnings, 'from' | 'to'>, step: -1 | 1): string =>
  step === -1 ? addDays(earnings.from, -1) : addDays(earnings.to, 1);
