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
 * Her Ventes (CR-04): the period that holds a day, and her part over it out of her sales (`creatorSales`, the totals'
 * rule). Only her part leaves: never the gross, the platform's share, the agency's, nor who sold. Pure.
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

/**
 * Her part over `range` out of her sales: a total per currency (refunds taken off, as the rows already are), the lines
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
  const totals = new Map<string, CreatorEarningsTotal>();
  for (const row of sales.rows) {
    const before = totals.get(row.currency);
    totals.set(row.currency, {
      currency: row.currency,
      creatorMinor: (before?.creatorMinor ?? 0) + row.creatorMinor,
      sales: (before?.sales ?? 0) + row.sales,
      refunds: (before?.refunds ?? 0) + row.refunds,
    });
  }
  const lines: CreatorEarningsLine[] = [...sales.lines]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((line) => ({
      occurredAt: line.occurredAt,
      event: line.event,
      saleType: line.saleType,
      currency: line.currency,
      creatorMinor: line.creatorMinor,
      fanName: line.fanId === null ? null : (input.names.get(line.fanId) ?? null),
    }));
  return {
    period: input.period,
    from: sales.from,
    to: sales.to,
    estimated: sales.to >= input.today,
    latest: sales.from <= input.today && input.today <= sales.to,
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    lines: lines.slice(0, EARNINGS_MAX_LINES),
    linesOmitted: Math.max(0, lines.length - EARNINGS_MAX_LINES),
    refundsWithoutSale: sales.refundsWithoutSale,
  };
}
