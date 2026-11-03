import {
  CurrencySchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleEventSchema,
  SaleTypeSchema,
  type CreatorSales,
} from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import { creatorSales } from '../../domain/creator-sales';
import type { TotalsRange } from '../../domain/sales-totals';

const DAY_MS = 86_400_000;

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));
const minor = z.coerce.number().int();

/** A row of the view `creator_sales`: it has no chatter and no platform fan id to read. */
const RowSchema = z.object({
  platform: PlatformSchema,
  platform_sale_id: z.string(),
  event: SaleEventSchema,
  sale_type: SaleTypeSchema,
  platform_account_id: PlatformAccountIdSchema,
  occurred_at: instant,
  currency: CurrencySchema,
  gross_incl_vat_minor: minor,
  gross_excl_vat_minor: minor,
  net_minor: minor,
  agency_minor: minor,
  creator_minor: minor,
  fan_id: FanIdSchema.nullable(),
});

/**
 * @public
 * A creator's own sales (CRM-04 lot d, ADR 0054), in the caller's transaction, which is `withCreatorAccount`: the
 * view `creator_sales` gives any other transaction nothing, and her creator comes from her account, never from a
 * request. The route of her Ventes screen (CR-04) reads this and nothing else of `connectors`.
 */
export const creatorSalesReads = {
  salesOf: async (tx: Transaction, range: TotalsRange): Promise<CreatorSales> => {
    // As the totals read them: the lines whose sale happened in the days, a day padded on each side for the zones, the
    // rule placing them on their sale's day exactly. A refund comes after its sale, so `l.occurred_at` bounds every
    // line from below.
    const start = new Date(Date.parse(`${range.from}T00:00:00Z`) - DAY_MS);
    const end = new Date(Date.parse(`${range.to}T00:00:00Z`) + 2 * DAY_MS);
    const saleAt = sql`coalesce(case when l.event = 'sale' then l.occurred_at else s.occurred_at end, l.occurred_at)`;
    const result = await tx.execute(sql`
      select l.platform, l.platform_sale_id, l.event, l.sale_type, l.platform_account_id, l.occurred_at, l.currency,
             l.gross_incl_vat_minor, l.gross_excl_vat_minor, l.net_minor, l.agency_minor, l.creator_minor, l.fan_id
        from creator_sales l
        left join creator_sales s
          on l.event = 'refund' and s.event = 'sale' and s.platform = l.platform and s.platform_sale_id = l.platform_sale_id
       where l.occurred_at >= ${start}
         and ${saleAt} >= ${start}
         and ${saleAt} < ${end}`);
    return creatorSales(
      result.rows.map((row) => {
        const parsed = RowSchema.parse(row);
        return {
          platform: parsed.platform,
          platformSaleId: parsed.platform_sale_id,
          event: parsed.event,
          saleType: parsed.sale_type,
          platformAccountId: parsed.platform_account_id,
          occurredAt: parsed.occurred_at,
          currency: parsed.currency,
          grossInclVat: parsed.gross_incl_vat_minor,
          grossExclVat: parsed.gross_excl_vat_minor,
          net: parsed.net_minor,
          agency: parsed.agency_minor,
          creator: parsed.creator_minor,
          fanId: parsed.fan_id,
        };
      }),
      range,
    );
  },
};
