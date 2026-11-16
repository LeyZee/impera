import type {
  CreatorEarningsDay,
  CreatorEarningsPeriod,
  CreatorEarningsSum,
  CreatorSales,
  Currency,
  PayPeriod,
} from '@impera/contracts';

/**
 * Her share over a fortnight (ADR 0106 § 15 to § 19), pure: her sales as her view reads them (`creatorSales`, a refund
 * on its sale's day, her days in her zone), summed by day and currency. Only `creatorMinor` comes out, the platform's
 * own figure: never the agency's share, the net, the price paid nor the seller. No currency is converted.
 */

interface Sum {
  shareMinor: number;
  sales: number;
  refunds: number;
  refundedMinor: number;
}

const empty = (): Sum => ({ shareMinor: 0, sales: 0, refunds: 0, refundedMinor: 0 });

const toSum = (currency: Currency, sum: Sum): CreatorEarningsSum => ({ currency, ...sum });

const byCurrency = (a: CreatorEarningsSum, b: CreatorEarningsSum): number =>
  a.currency.localeCompare(b.currency);

export function creatorEarnings(sales: CreatorSales, from: PayPeriod): CreatorEarningsPeriod {
  const days = new Map<string, Map<Currency, Sum>>();
  const at = (day: string, currency: Currency): Sum => {
    const ofDay = days.get(day) ?? new Map<Currency, Sum>();
    days.set(day, ofDay);
    const sum = ofDay.get(currency) ?? empty();
    ofDay.set(currency, sum);
    return sum;
  };
  for (const row of sales.rows) {
    const sum = at(row.day, row.currency);
    sum.shareMinor += row.creatorMinor;
    sum.sales += row.sales;
    sum.refunds += row.refunds;
  }
  // What each refund took off her share, on its sale's day: the line's own amount, never signed.
  for (const line of sales.lines) {
    if (line.event === 'refund') at(line.saleDay, line.currency).refundedMinor += line.creatorMinor;
  }
  const totals = new Map<Currency, Sum>();
  const dayList: CreatorEarningsDay[] = [];
  for (const [day, ofDay] of days) {
    for (const [currency, sum] of ofDay) {
      const total = totals.get(currency) ?? empty();
      total.shareMinor += sum.shareMinor;
      total.sales += sum.sales;
      total.refunds += sum.refunds;
      total.refundedMinor += sum.refundedMinor;
      totals.set(currency, total);
    }
    dayList.push({
      day,
      sums: [...ofDay].map(([currency, sum]) => toSum(currency, sum)).toSorted(byCurrency),
    });
  }
  return {
    from,
    to: sales.to,
    totals: [...totals].map(([currency, sum]) => toSum(currency, sum)).toSorted(byCurrency),
    days: dayList.toSorted((a, b) => b.day.localeCompare(a.day)),
    refundsWithoutSale: sales.refundsWithoutSale,
  };
}
