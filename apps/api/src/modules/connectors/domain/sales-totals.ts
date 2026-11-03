import type {
  Currency,
  Platform,
  PlatformAccountId,
  SaleEvent,
  SaleSeller,
  SaleType,
  SalesTotals,
  SalesTotalsRow,
} from '@nirvana/contracts';

import { onSaleDays, salesFeedTimeZone, sumsBy, type SaleDayLine } from './sale-days';

/**
 * The sales totals of CRM-04, the one sum the Dashboard, the evening digest and the creator's screen read: each line
 * on its sale's day in the platform's zone, a refund taken off its sale's day, by the rule CRM-02 checks against the
 * platform's daily statistics (`sale-days.ts`). So a month of totals gives `/v1/stats/daily` back, to the cent. Sums
 * only: no VAT, no commission, no conversion (ADR 0050 § 8); each currency stays apart. Pure.
 */

/** A line of a creator's register as the totals read it. */
export interface TotalsLine extends SaleDayLine {
  readonly platform: Platform;
  readonly platformAccountId: PlatformAccountId;
  readonly saleType: SaleType;
  readonly currency: Currency;
  /** The owner's link of the line's own chatter; a refund is counted with its sale's seller. */
  readonly seller: SaleSeller;
}

/** Days `from` to `to`, both included, each platform's read in its own zone. */
export interface TotalsRange {
  readonly from: string;
  readonly to: string;
}

function sellerKey(seller: SaleSeller): string {
  return seller.kind === 'member' ? `member:${seller.memberId}` : seller.kind;
}

type RowHead = Pick<
  SalesTotalsRow,
  'day' | 'platform' | 'platformAccountId' | 'currency' | 'saleType' | 'seller'
>;

/**
 * The totals of `lines` over `range`, a row per day, account, currency, kind of sale and seller, each a refund's taken
 * from its sale. A refund of the range whose sale is not among the lines (older than the register) is in no row and
 * is counted apart. The rows come by day, then platform, account, currency, kind and seller.
 */
export function salesTotals(lines: readonly TotalsLine[], range: TotalsRange): SalesTotals {
  const byPlatform = new Map<Platform, TotalsLine[]>();
  for (const line of lines) byPlatform.set(line.platform, [...(byPlatform.get(line.platform) ?? []), line]);
  const heads = new Map<string, RowHead>();
  const rows: { readonly key: string; readonly row: SalesTotalsRow }[] = [];
  let refundsWithoutSale = 0;
  for (const [platform, ofPlatform] of byPlatform) {
    const timeZone = salesFeedTimeZone(platform);
    // A line exists only through a feed, and a feed has its zone: a platform without one is a programming error.
    if (timeZone === null) throw new Error(`sales totals: no zone for the platform ${platform}`);
    const placed = onSaleDays(ofPlatform, { ...range, timeZone });
    refundsWithoutSale += placed.refundsWithoutSale.length;
    const sums = sumsBy(placed.placed, ({ sale, day }) => {
      const key = [
        day,
        sale.platform,
        sale.platformAccountId,
        sale.currency,
        sale.saleType,
        sellerKey(sale.seller),
      ].join('|');
      if (!heads.has(key)) {
        heads.set(key, {
          day,
          platform: sale.platform,
          platformAccountId: sale.platformAccountId,
          currency: sale.currency,
          saleType: sale.saleType,
          seller: sale.seller,
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
  }
  rows.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { from: range.from, to: range.to, rows: rows.map(({ row }) => row), refundsWithoutSale };
}

/**
 * How long after a sale its first reading still rings (CRM-04, Bilan): an older sale, read late (a webhook missed,
 * the cursor catching up), is late. It enters the totals and the evening digest, and alerts no one. Set in the code,
 * never by a user.
 */
export const SALE_RING_WINDOW_MS = 15 * 60_000;

/** Whether a line just recorded rings: a sale, recorded less than the window after it happened. A refund never. */
export function ringsWhenRecorded(
  line: { readonly event: SaleEvent; readonly occurredAt: Date },
  recordedAt: Date,
): boolean {
  return line.event === 'sale' && recordedAt.getTime() - line.occurredAt.getTime() < SALE_RING_WINDOW_MS;
}
