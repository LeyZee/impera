import { calendarDayAt, type Platform, type SaleEvent } from '@impera/contracts';

/**
 * The register's lines summed by their sale's day (ADR 0050 § 7), the one rule the reliability check (CRM-02) and the
 * totals of the Dashboard, the evening digest and the creator's screen (CRM-04) share: a sale counts on its own day in
 * the platform's zone, a refund is taken off its sale's day, as the platform's daily statistics do. So the totals of a
 * month give `/v1/stats/daily` back, to the cent, as the check proves. Pure.
 */

/**
 * The zone each platform counts its statistics' days in. Its adapter reports the same (`SalesFeed.timeZone`); a
 * platform without a sales feed has no line to place.
 */
export const SALES_FEED_TIME_ZONES = { reveal: 'Europe/Paris' } as const satisfies Partial<
  Record<Platform, string>
>;

const zones: Readonly<Partial<Record<Platform, string>>> = SALES_FEED_TIME_ZONES;

/** The zone of a platform's statistics' days, `null` for a platform without a sales feed. */
export function salesFeedTimeZone(platform: Platform): string | null {
  return zones[platform] ?? null;
}

/** A line of the register as the sums read it: amounts as recorded, a refund carrying its sale's, never signed. */
export interface SaleDayLine {
  readonly platformSaleId: string;
  readonly event: SaleEvent;
  readonly occurredAt: Date;
  readonly grossInclVat: number;
  readonly grossExclVat: number;
  readonly net: number;
  readonly agency: number;
  readonly creator: number;
}

/** A line on its sale's day, with that sale (itself for a sale). */
export interface PlacedLine<L extends SaleDayLine> {
  readonly line: L;
  readonly sale: L;
  readonly day: string;
}

/** Days `from` to `to`, both included, read in `timeZone`. */
export interface SaleDayRange {
  readonly from: string;
  readonly to: string;
  readonly timeZone: string;
}

/**
 * Each line on its sale's day: a sale on its own, a refund on its sale's, found among `lines` by `platformSaleId`. A
 * line whose sale's day is out of the range is left out. A refund whose sale is not among the lines (older than the
 * register, or than what was read) is placed nowhere: it comes back apart when its own day is in the range, for the
 * reader to count (CRM-02 says it in a note).
 */
export function onSaleDays<L extends SaleDayLine>(
  lines: readonly L[],
  range: SaleDayRange,
): { readonly placed: readonly PlacedLine<L>[]; readonly refundsWithoutSale: readonly L[] } {
  const inDays = (day: string): boolean => day >= range.from && day <= range.to;
  const sales = new Map<string, L>();
  for (const line of lines) if (line.event === 'sale') sales.set(line.platformSaleId, line);
  const placed: PlacedLine<L>[] = [];
  const refundsWithoutSale: L[] = [];
  for (const line of lines) {
    const sale = line.event === 'sale' ? line : sales.get(line.platformSaleId);
    if (sale === undefined) {
      if (inDays(calendarDayAt(line.occurredAt, range.timeZone))) refundsWithoutSale.push(line);
      continue;
    }
    const day = calendarDayAt(sale.occurredAt, range.timeZone);
    if (inDays(day)) placed.push({ line, sale, day });
  }
  return { placed, refundsWithoutSale };
}

/** What lines add up to: how many sales and refunds, and the five amounts, a refund taken off. */
export interface SaleSums {
  readonly sales: number;
  readonly refunds: number;
  readonly grossInclVat: number;
  readonly grossExclVat: number;
  readonly net: number;
  readonly agency: number;
  readonly creator: number;
}

const NO_SALES: SaleSums = {
  sales: 0,
  refunds: 0,
  grossInclVat: 0,
  grossExclVat: 0,
  net: 0,
  agency: 0,
  creator: 0,
};

/** `sums` with one more line: a sale adds its amounts, a refund takes them off. */
function withLine(sums: SaleSums, line: SaleDayLine): SaleSums {
  const sign = line.event === 'refund' ? -1 : 1;
  return {
    sales: sums.sales + (line.event === 'sale' ? 1 : 0),
    refunds: sums.refunds + (line.event === 'refund' ? 1 : 0),
    grossInclVat: sums.grossInclVat + sign * line.grossInclVat,
    grossExclVat: sums.grossExclVat + sign * line.grossExclVat,
    net: sums.net + sign * line.net,
    agency: sums.agency + sign * line.agency,
    creator: sums.creator + sign * line.creator,
  };
}

/** The placed lines summed by `keyOf`, in the order each key first comes. */
export function sumsBy<L extends SaleDayLine, K>(
  placed: readonly PlacedLine<L>[],
  keyOf: (placed: PlacedLine<L>) => K,
): Map<K, SaleSums> {
  const sums = new Map<K, SaleSums>();
  for (const one of placed) {
    const key = keyOf(one);
    sums.set(key, withLine(sums.get(key) ?? NO_SALES, one.line));
  }
  return sums;
}
