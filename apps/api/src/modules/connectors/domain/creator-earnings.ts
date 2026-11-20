import type {
  CreatorEarnings,
  CreatorEarningsLine,
  CreatorEarningsTotal,
  CreatorSales,
  EarningsPeriod,
  FanId,
} from '@impera/contracts';
import { EARNINGS_MAX_LINES } from '@impera/contracts';

import type { TotalsRange } from './sales-totals';

/**
 * Her Ventes (CR-04, ADR 0157): the period that holds a day, and the whole path of her sales over it (`creatorSales`, the
 * totals' rule): what her fans paid, VAT, Reveal, the agency, her. Never who sold. Pure.
 */

/** `YYYY-MM-DD` moved by `count` days, on the calendar alone. */
function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

/** The last day of the month of `day`. */
function monthEnd(day: string): string {
  const date = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
}

/** The days of the period that holds `day`, both included: the day, its fortnight (1–15, 16–end) or its month. */
export function periodRange(period: EarningsPeriod, day: string): TotalsRange {
  const month = day.slice(0, 7);
  switch (period) {
    case 'day':
      return { from: day, to: day };
    case 'fortnight':
      return Number(day.slice(8, 10)) <= 15
        ? { from: `${month}-01`, to: `${month}-15` }
        : { from: `${month}-16`, to: monthEnd(day) };
    case 'month':
      return { from: `${month}-01`, to: monthEnd(day) };
  }
}

/** Whether `day` may be read: today at the latest, `maxBack` days back at most. */
export function readableDay(day: string, today: string, maxBack: number): boolean {
  return day <= today && day >= addDays(today, -maxBack);
}

/** `part` over `base` in basis points, rounded half up; `null` when `base` is zero or less (ADR 0157 § 6). */
export function shareBp(part: number, base: number): number | null {
  return base > 0 ? Math.round((part * 10_000) / base) : null;
}

/**
 * The path over `range` out of her sales: a total per currency (refunds taken off, as the rows already are), the lines
 * the newest first with the fan's name when his card is hers, `EARNINGS_MAX_LINES` at most.
 */
export function creatorEarnings(
  sales: CreatorSales,
  input: {
    readonly period: EarningsPeriod;
    readonly today: string;
    readonly names: ReadonlyMap<FanId, string>;
  },
): CreatorEarnings {
  const sums = new Map<
    string,
    Omit<CreatorEarningsTotal, 'shareOfNetBp' | 'agencyShareOfNetBp' | 'shareOfPaidBp'>
  >();
  for (const row of sales.rows) {
    const before = sums.get(row.currency);
    sums.set(row.currency, {
      currency: row.currency,
      sales: (before?.sales ?? 0) + row.sales,
      refunds: (before?.refunds ?? 0) + row.refunds,
      grossInclVatMinor: (before?.grossInclVatMinor ?? 0) + row.grossInclVatMinor,
      grossExclVatMinor: (before?.grossExclVatMinor ?? 0) + row.grossExclVatMinor,
      netMinor: (before?.netMinor ?? 0) + row.netMinor,
      agencyMinor: (before?.agencyMinor ?? 0) + row.agencyMinor,
      creatorMinor: (before?.creatorMinor ?? 0) + row.creatorMinor,
    });
  }
  const totals: CreatorEarningsTotal[] = [...sums.values()].map((sum) => ({
    ...sum,
    shareOfNetBp: shareBp(sum.creatorMinor, sum.netMinor),
    agencyShareOfNetBp: shareBp(sum.agencyMinor, sum.netMinor),
    shareOfPaidBp: shareBp(sum.creatorMinor, sum.grossInclVatMinor),
  }));
  const lines: CreatorEarningsLine[] = [...sales.lines]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((line) => ({
      occurredAt: line.occurredAt,
      saleDay: line.saleDay,
      event: line.event,
      saleType: line.saleType,
      currency: line.currency,
      grossInclVatMinor: line.grossInclVatMinor,
      grossExclVatMinor: line.grossExclVatMinor,
      netMinor: line.netMinor,
      agencyMinor: line.agencyMinor,
      creatorMinor: line.creatorMinor,
      shareOfNetBp: shareBp(line.creatorMinor, line.netMinor),
      fanName: line.fanId === null ? null : (input.names.get(line.fanId) ?? null),
    }));
  return {
    period: input.period,
    from: sales.from,
    to: sales.to,
    estimated: sales.to >= input.today,
    latest: sales.from <= input.today && input.today <= sales.to,
    totals: totals.sort((a, b) => a.currency.localeCompare(b.currency)),
    lines: lines.slice(0, EARNINGS_MAX_LINES),
    linesOmitted: Math.max(0, lines.length - EARNINGS_MAX_LINES),
    refundsWithoutSale: sales.refundsWithoutSale,
  };
}
