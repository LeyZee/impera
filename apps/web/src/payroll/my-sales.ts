import type { Currency, MySale, MySalesDay, SaleSignalKind } from '@nirvana/contracts';

import { amountText, signedAmountText } from '@/reports/model';
import { clockAt, longDay } from '@/scheduling/time';

/**
 * Commissions › « Mes ventes lues » (CRM-03 lot b4c, ADR 0050 § 10), without React: what a line of the member's own
 * statement is, where it stands, and what a signal does. Never the sale's key nor a fan: the hour, the account and the
 * net only. The server decides what may be done (`open`) and refuses the rest; the screen only says it.
 */

const NBSP = ' ';

/** A count tied to its noun, so that a phone never wraps « 1 » away from « vente ». */
const counted = (count: number, one: string, many: string): string =>
  `${String(count)}${NBSP}${count > 1 ? many : one}`;

/** « Vente de 22 h 05 », « Remboursement de 9 h 15 », « Vente, heure inconnue ». */
export function mySaleWhen(sale: Pick<MySale, 'event' | 'occurredAt'>, timeZone: string): string {
  const what = sale.event === 'sale' ? 'Vente' : 'Remboursement';
  return sale.occurredAt === null
    ? `${what}, heure inconnue`
    : `${what} de ${clockAt(sale.occurredAt, timeZone)}`;
}

/** The line's net, signed: a refund takes off. */
export const mySaleAmount = (sale: Pick<MySale, 'netMinor' | 'currency'>): string =>
  signedAmountText(sale.netMinor, sale.currency);

/** Where a line stands, on its chip. */
export function mySaleStateText(state: MySale['state']): string {
  switch (state) {
    case 'counted':
      return 'Comptée';
    case 'signalled':
      return 'Signalée';
    case 'excluded':
      return 'Écartée';
    case 'removed':
      return 'Retirée du relevé';
  }
}

/** A line waits on a validator while it is signalled and the period still open: the one amber chip. */
export const mySaleWaits = (sale: Pick<MySale, 'state' | 'open'>): boolean =>
  sale.state === 'signalled' && sale.open;

/** What the line says under it, `null` for a line counted with nothing more to say. */
export function mySaleNote(sale: Pick<MySale, 'state' | 'open' | 'signal'>, closed: boolean): string | null {
  switch (sale.state) {
    case 'counted':
      return closed || sale.open ? null : 'Comptée par une clôture : elle ne change plus.';
    case 'signalled':
      return sale.open
        ? 'Tu l’as signalée : elle compte pour toi tant qu’un valideur ne l’a pas écartée.'
        : 'Tu l’avais signalée, la clôture l’a comptée pour toi.';
    case 'excluded':
      return 'Tu l’as signalée et un valideur l’a écartée : elle ne compte pas pour toi.';
    case 'removed':
      return 'Tu l’avais signalée : elle n’est plus sur ton relevé.';
  }
}

/** The member's own note on their signal, quoted, `null` for none. */
export const mySignalNote = (sale: Pick<MySale, 'signal'>): string | null =>
  sale.signal?.note == null ? null : `«${NBSP}${sale.signal.note}${NBSP}»`;

/** « Mercredi 28 octobre », « Heure inconnue » for lines without an instant. */
export function myDayTitle(day: string | null): string {
  if (day === null) return 'Heure inconnue';
  const long = longDay(day);
  return `${long.charAt(0).toUpperCase()}${long.slice(1)}`;
}

/** A day's head: « 3 ventes · 1 remboursement · 126,00 € », the lines still on the statement only. */
export function myDayLine(day: Pick<MySalesDay, 'sales' | 'refunds' | 'nets'> | undefined): string {
  if (day === undefined) return 'Rien de compté ce jour';
  const parts = [
    day.sales === 0 ? null : counted(day.sales, 'vente', 'ventes'),
    day.refunds === 0 ? null : counted(day.refunds, 'remboursement', 'remboursements'),
    ...day.nets.map((net) => amountText(net.netMinor, net.currency)),
  ].filter((one) => one !== null);
  return parts.join(' · ');
}

/** The period's lines, counted: « 12 ventes lues · 2 remboursements », in the panel's head. */
export function mySalesCountText(days: readonly Pick<MySalesDay, 'sales' | 'refunds'>[]): string {
  const sales = days.reduce((sum, day) => sum + day.sales, 0);
  const refunds = days.reduce((sum, day) => sum + day.refunds, 0);
  return [
    counted(sales, 'vente lue', 'ventes lues'),
    refunds === 0 ? null : counted(refunds, 'remboursement', 'remboursements'),
  ]
    .filter((one) => one !== null)
    .join(' · ');
}

/** The net of the period per currency, as the days sum it. */
export function mySalesNets(
  days: readonly Pick<MySalesDay, 'nets'>[],
): readonly { readonly currency: Currency; readonly netMinor: number }[] {
  const nets = new Map<Currency, number>();
  for (const day of days)
    for (const net of day.nets) nets.set(net.currency, (nets.get(net.currency) ?? 0) + net.netMinor);
  return [...nets.entries()].map(([currency, netMinor]) => ({ currency, netMinor }));
}

/** A gesture's button on the line. */
export const signalLabel = (kind: SaleSignalKind): string =>
  kind === 'signal' ? 'Ce n’est pas ma vente' : 'Retirer le signalement';

/** What the sheet asks and says before a gesture is sent. */
export interface SignalWords {
  readonly title: string;
  readonly lead: string;
  readonly confirm: string;
}

/** The sheet of a gesture: what it does to the line, and that it changes no amount by itself. */
export function signalWords(kind: SaleSignalKind): SignalWords {
  return kind === 'signal'
    ? {
        title: 'Ce n’est pas ta vente ?',
        lead: 'Un valideur la verra. Elle reste sur ton relevé et compte pour toi tant qu’il ne l’a pas écartée. Tu peux retirer ton signalement jusqu’à la clôture.',
        confirm: 'Signaler la vente',
      }
    : {
        title: 'Retirer ton signalement ?',
        lead: 'La vente reste comptée pour toi et le valideur ne la voit plus comme signalée.',
        confirm: 'Retirer le signalement',
      };
}
