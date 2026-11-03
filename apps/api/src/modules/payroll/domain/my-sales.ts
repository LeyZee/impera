import {
  calendarDayAt,
  type Currency,
  type MySaleState,
  type PayPeriod,
  type PlatformAccountId,
  type SaleSignalKind,
} from '@nirvana/contracts';

import { saleIdOf, saleKeyOf, type SaleKey } from './sales';

/**
 * A member's own lines of a period, as they read them (CRM-03 lot b4c, ADR 0050 § 10), pure: from their statement and
 * their own signals only, never from the register. Each line says where it stands for them, and
 * whether they may signal it or take their signal back now.
 */

/** A line as the member's statement keeps it: its account and currency are its statement line's. */
export interface OwnStatementSale extends SaleKey {
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly netMinor: number;
  readonly lateFrom: PayPeriod | null;
  readonly occurredAt: Date | null;
}

/** The member's latest signal on a line of the period, with what the line was on their statement when written. */
export interface OwnSignal extends SaleKey {
  readonly kind: SaleSignalKind;
  readonly note: string | null;
  readonly createdAt: Date;
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly netMinor: number;
  readonly occurredAt: Date | null;
}

/** One of the member's lines, where it stands, their signal in force (or kept) and whether a gesture is open. */
export interface MyLine extends OwnStatementSale {
  readonly state: MySaleState;
  readonly signal: { readonly note: string | null; readonly signalledAt: Date } | null;
  readonly open: boolean;
}

/** A day of the member's lines on their statement, in the agency's zone (`null`: lines without an instant). */
export interface MyDay {
  readonly day: string | null;
  readonly sales: number;
  readonly refunds: number;
  readonly nets: readonly { readonly currency: Currency; readonly netMinor: number }[];
}

/** Where a page starts: after the line of this instant (`null`: none) and key, in the order of `myLines`. */
export interface MyLinesAfter {
  readonly occurredAt: number | null;
  readonly key: string;
}

const instantOf = (line: { readonly occurredAt: Date | null }): number | null =>
  line.occurredAt === null ? null : line.occurredAt.getTime();

/** The most recent first, lines without an instant last, then by key: one order, for the page and its cursor. */
function compareMine(a: MyLinesAfter, b: MyLinesAfter): number {
  if (a.occurredAt !== b.occurredAt) {
    if (a.occurredAt === null) return 1;
    if (b.occurredAt === null) return -1;
    return b.occurredAt - a.occurredAt;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

export const placeOfLine = (line: SaleKey & { readonly occurredAt: Date | null }): MyLinesAfter => ({
  occurredAt: instantOf(line),
  key: saleKeyOf(line),
});

/**
 * The member's lines of the period (see above), in the order of `compareMine`:
 * - each line of their statement: `signalled` with their signal in force, `counted` otherwise;
 * - each line they signalled that has left it since (the signal in force kept): `excluded` when the latest decision
 *   they read on its sale excludes it, `removed` otherwise, as the signal kept it.
 * A gesture is `open` on a line of the statement while the period is not closed and no closing counted the line.
 */
export function myLines(input: {
  readonly statement: readonly OwnStatementSale[];
  readonly signals: readonly OwnSignal[];
  /** The sales whose latest decision the member reads excludes them, by `saleIdOf`. */
  readonly excluded: ReadonlySet<string>;
  /** The member's lines a closing counted, by `saleKeyOf`. */
  readonly registered: ReadonlySet<string>;
  readonly closed: boolean;
}): MyLine[] {
  const signalOf = new Map(input.signals.map((one) => [saleKeyOf(one), one]));
  const lines: MyLine[] = [];
  const onStatement = new Set<string>();
  for (const sale of input.statement) {
    const key = saleKeyOf(sale);
    onStatement.add(key);
    const signal = signalOf.get(key);
    const inForce = signal?.kind === 'signal';
    lines.push({
      ...sale,
      state: inForce ? 'signalled' : 'counted',
      signal: inForce ? { note: signal.note, signalledAt: signal.createdAt } : null,
      open: !input.closed && !input.registered.has(key),
    });
  }
  for (const signal of input.signals) {
    const key = saleKeyOf(signal);
    if (signal.kind !== 'signal' || onStatement.has(key)) continue;
    lines.push({
      platform: signal.platform,
      platformSaleId: signal.platformSaleId,
      event: signal.event,
      platformAccountId: signal.platformAccountId,
      currency: signal.currency,
      netMinor: signal.netMinor,
      lateFrom: null,
      occurredAt: signal.occurredAt,
      state: input.excluded.has(saleIdOf(signal)) ? 'excluded' : 'removed',
      signal: { note: signal.note, signalledAt: signal.createdAt },
      open: false,
    });
  }
  return lines.sort((a, b) => compareMine(placeOfLine(a), placeOfLine(b)));
}

/**
 * The days of the member's lines still on their statement, the most recent first and those without an instant last:
 * how many sales and refunds, and their net per currency. A line that has left the statement pays nothing: not counted.
 */
export function myDays(lines: readonly MyLine[], timeZone: string): MyDay[] {
  const days = new Map<string | null, { sales: number; refunds: number; nets: Map<Currency, number> }>();
  for (const line of lines) {
    if (line.state !== 'counted' && line.state !== 'signalled') continue;
    const day = line.occurredAt === null ? null : calendarDayAt(line.occurredAt, timeZone);
    const found = days.get(day) ?? { sales: 0, refunds: 0, nets: new Map<Currency, number>() };
    if (line.event === 'sale') found.sales += 1;
    else found.refunds += 1;
    found.nets.set(line.currency, (found.nets.get(line.currency) ?? 0) + line.netMinor);
    days.set(day, found);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1))
    .map(([day, found]) => ({
      day,
      sales: found.sales,
      refunds: found.refunds,
      nets: [...found.nets.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([currency, netMinor]) => ({ currency, netMinor })),
    }));
}

/** A page of `lines` after `after` (`null`: from the first), and where the next one starts (`null`: none). */
export function pageOfLines(
  lines: readonly MyLine[],
  after: MyLinesAfter | null,
  limit: number,
): { readonly items: MyLine[]; readonly next: MyLinesAfter | null } {
  const rest = after === null ? lines : lines.filter((line) => compareMine(placeOfLine(line), after) > 0);
  const items = rest.slice(0, limit);
  const last = items.at(-1);
  return { items, next: rest.length > limit && last !== undefined ? placeOfLine(last) : null };
}
