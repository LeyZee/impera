import type {
  CreatorSaleLine,
  CreatorSales,
  CreatorSalesRow,
  Currency,
  FanId,
  Platform,
  PlatformAccountId,
  SaleType,
} from '@nirvana/contracts';

import { onSaleDays, salesFeedTimeZone, sumsBy, type SaleDayLine } from './sale-days';
import type { TotalsRange } from './sales-totals';

/**
 * A creator's own sales (CRM-04 lot d, ADR 0054): the rule of the totals (`sale-days.ts`, the one CRM-02 checks
 * against the platform's daily statistics), without the seller, which her view does not have. So her « Ta part » is
 * the sum of `modelRevenue` that Reveal gives, to the cent, whether the team's pay has switched or not. Pure.
 */

/** A line of her view `creator_sales`: never the chatter nor the platform's fan, his card's id when it is hers. */
export interface CreatorLine extends SaleDayLine {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly saleType: SaleType;
  readonly currency: Currency;
  readonly fanId: FanId | null;
}

type RowHead = Pick<CreatorSalesRow, 'day' | 'platform' | 'platformAccountId' | 'currency' | 'saleType'>;

/**
 * Her sales over `range`: a row per day, account, currency and kind of sale, a refund taken off its sale's day, and
 * each line on that day. A refund of the range whose sale is older than the register is in no row and no line, only
 * counted. Rows come by day, then platform, account, currency and kind; lines by instant.
 */
export function creatorSales(lines: readonly CreatorLine[], range: TotalsRange): CreatorSales {
  const byPlatform = new Map<Platform, CreatorLine[]>();
  for (const line of lines) byPlatform.set(line.platform, [...(byPlatform.get(line.platform) ?? []), line]);
  const heads = new Map<string, RowHead>();
  const rows: { readonly key: string; readonly row: CreatorSalesRow }[] = [];
  const placedLines: CreatorSaleLine[] = [];
  let refundsWithoutSale = 0;
  for (const [platform, ofPlatform] of byPlatform) {
    const timeZone = salesFeedTimeZone(platform);
    // A line exists only through a feed, and a feed has its zone: a platform without one is a programming error.
    if (timeZone === null) throw new Error(`creator sales: no zone for the platform ${platform}`);
    const placed = onSaleDays(ofPlatform, { ...range, timeZone });
    refundsWithoutSale += placed.refundsWithoutSale.length;
    const sums = sumsBy(placed.placed, ({ sale, day }) => {
      const key = [day, sale.platform, sale.platformAccountId, sale.currency, sale.saleType].join('|');
      if (!heads.has(key)) {
        heads.set(key, {
          day,
          platform: sale.platform,
          platformAccountId: sale.platformAccountId,
          currency: sale.currency,
          saleType: sale.saleType,
        });
      }
      return key;
    });
    for (const [key, sum] of sums) {
      const head = heads.get(key);
      if (head === undefined) continue;
      rows.push({
        key,
        row: {
          ...head,
          sales: sum.sales,
          refunds: sum.refunds,
          grossInclVatMinor: sum.grossInclVat,
          grossExclVatMinor: sum.grossExclVat,
          netMinor: sum.net,
          agencyMinor: sum.agency,
          creatorMinor: sum.creator,
        },
      });
    }
    for (const { line, day } of placed.placed) {
      placedLines.push({
        platform: line.platform,
        platformAccountId: line.platformAccountId,
        event: line.event,
        saleType: line.saleType,
        occurredAt: line.occurredAt.toISOString(),
        saleDay: day,
        currency: line.currency,
        grossInclVatMinor: line.grossInclVat,
        grossExclVatMinor: line.grossExclVat,
        netMinor: line.net,
        agencyMinor: line.agency,
        creatorMinor: line.creator,
        fanId: line.fanId,
      });
    }
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  // By instant, a sale before its refund of the same instant.
  placedLines.sort((a, b) => {
    if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
    if (a.event === b.event) return 0;
    return a.event === 'sale' ? -1 : 1;
  });
  return {
    from: range.from,
    to: range.to,
    rows: rows.map(({ row }) => row),
    lines: placedLines,
    refundsWithoutSale,
  };
}
