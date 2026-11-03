import {
  CurrencySchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleEventSchema,
  SaleTypeSchema,
  type CreatorId,
  type SalesTotals,
} from '@nirvana/contracts';
import { sql, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import { salesTotals, type TotalsLine } from '../../domain/sales-totals';

import { sellerOf } from './seller';

/** Which totals a read gives: one creator's, from `from` to `to`, days both included. */
export interface SalesTotalsQuery {
  readonly creatorId: CreatorId;
  readonly from: string;
  readonly to: string;
}

const DAY_MS = 86_400_000;

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));
const minor = z.coerce.number().int();

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
  platform_chatter_id: z.string().nullable(),
  kind: z.string().nullable(),
  member_id: z.string().nullable(),
});

function lineOf(row: z.infer<typeof RowSchema>): TotalsLine {
  return {
    platform: row.platform,
    platformSaleId: row.platform_sale_id,
    event: row.event,
    saleType: row.sale_type,
    platformAccountId: row.platform_account_id,
    occurredAt: row.occurred_at,
    currency: row.currency,
    grossInclVat: row.gross_incl_vat_minor,
    grossExclVat: row.gross_excl_vat_minor,
    net: row.net_minor,
    agency: row.agency_minor,
    creator: row.creator_minor,
    seller: sellerOf(
      row.platform_chatter_id,
      row.kind === null ? undefined : { kind: row.kind, memberId: row.member_id },
    ),
  };
}

/**
 * @public
 * The sales totals of CRM-04 (`salesTotals`), read in the caller's transaction through the connectors' `index.ts`:
 * under the creator's tenant for the Dashboard, as the admin role for the evening digest's job. The creator's own
 * screen never reads this: she has her view, with no seller (ADR 0053, lot d). A line in quarantine belongs to no
 * creator, so it is in no total.
 */
export const salesFeedTotals = {
  totalsOf: async (tx: Transaction, query: SalesTotalsQuery): Promise<SalesTotals> => {
    // The lines whose sale happened in the days, a day padded on each side for the zones: the rule places them on
    // their sale's day exactly. A refund comes after its sale, so `l.occurred_at` bounds every line from below, as the
    // reliability check reads it, and the index (`creator_id`, `occurred_at`) serves the read.
    const start = new Date(Date.parse(`${query.from}T00:00:00Z`) - DAY_MS);
    const end = new Date(Date.parse(`${query.to}T00:00:00Z`) + 2 * DAY_MS);
    const saleAt = sql`coalesce(case when l.event = 'sale' then l.occurred_at else s.occurred_at end, l.occurred_at)`;
    const result = await tx.execute(sql`
      select l.platform, l.platform_sale_id, l.event, l.sale_type, l.platform_account_id, l.occurred_at, l.currency,
             l.gross_incl_vat_minor, l.gross_excl_vat_minor, l.net_minor, l.agency_minor, l.creator_minor,
             l.platform_chatter_id, c.kind, c.member_id
        from platform_sales l
        left join platform_sales s
          on l.event = 'refund' and s.event = 'sale' and s.platform = l.platform and s.platform_sale_id = l.platform_sale_id
        left join sales_feed_chatters c on c.platform = l.platform and c.platform_chatter_id = l.platform_chatter_id
       where l.creator_id = ${query.creatorId}
         and l.occurred_at >= ${start}
         and ${saleAt} >= ${start}
         and ${saleAt} < ${end}`);
    return salesTotals(
      result.rows.map((row) => lineOf(RowSchema.parse(row))),
      { from: query.from, to: query.to },
    );
  },
};
