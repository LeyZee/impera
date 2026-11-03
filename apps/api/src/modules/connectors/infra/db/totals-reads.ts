import {
  CurrencySchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleEventSchema,
  SaleTypeSchema,
  type CreatorId,
  type SalesFeedReading,
  type SalesRefunds,
  type SalesTotals,
} from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import { refundsOfDay, salesTotals, type TotalsLine } from '../../domain/sales-totals';

import { lineChatter } from './line-chatter';
import { sellerOf } from './seller';

/** Which refunds a read gives: one creator's, of `day` (each on its own day in its platform's zone). */
export interface SalesRefundsQuery {
  readonly creatorId: CreatorId;
  readonly day: string;
}

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

const RefundRowSchema = RowSchema.extend({ sale_occurred_at: instant.nullable() });

const ReadingSchema = z.object({
  platform: PlatformSchema,
  read_at: instant.nullable(),
  paused_until: instant.nullable(),
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
             ${lineChatter} as platform_chatter_id, c.kind, c.member_id
        from platform_sales l
        left join platform_sales s
          on l.event = 'refund' and s.event = 'sale' and s.platform = l.platform and s.platform_sale_id = l.platform_sale_id
             and s.creator_id = l.creator_id
        left join sales_feed_chatters c on c.platform = l.platform and c.platform_chatter_id = ${lineChatter}
       where l.creator_id = ${query.creatorId}
         and l.occurred_at >= ${start}
         and ${saleAt} >= ${start}
         and ${saleAt} < ${end}`);
    return salesTotals(
      result.rows.map((row) => lineOf(RowSchema.parse(row))),
      { from: query.from, to: query.to },
    );
  },
  /**
   * The refunds of a day by their own day (CRM-04, the evening digest), whatever their sale's: the totals take a
   * refund off its sale's day, so this is how a refund of an older sale is said at all. Its seller is its sale's when
   * the sale is recorded, else the chatter the refund line names. In the caller's transaction, as `totalsOf`.
   */
  refundsOf: async (tx: Transaction, query: SalesRefundsQuery): Promise<SalesRefunds> => {
    // A day padded on each side for the zones: `refundsOfDay` keeps the refunds of the day exactly.
    const start = new Date(Date.parse(`${query.day}T00:00:00Z`) - DAY_MS);
    const end = new Date(Date.parse(`${query.day}T00:00:00Z`) + 2 * DAY_MS);
    const result = await tx.execute(sql`
      select l.platform, l.platform_sale_id, l.event, l.sale_type, l.platform_account_id, l.occurred_at, l.currency,
             l.gross_incl_vat_minor, l.gross_excl_vat_minor, l.net_minor, l.agency_minor, l.creator_minor,
             ${lineChatter} as platform_chatter_id, c.kind, c.member_id, s.occurred_at as sale_occurred_at
        from platform_sales l
        left join platform_sales s
          on l.event = 'refund' and s.event = 'sale' and s.platform = l.platform and s.platform_sale_id = l.platform_sale_id
             and s.creator_id = l.creator_id
        left join sales_feed_chatters c on c.platform = l.platform and c.platform_chatter_id = ${lineChatter}
       where l.creator_id = ${query.creatorId}
         and l.event = 'refund'
         and l.occurred_at >= ${start}
         and l.occurred_at < ${end}`);
    return refundsOfDay(
      result.rows.map((row) => {
        const parsed = RefundRowSchema.parse(row);
        return { ...lineOf(parsed), saleOccurredAt: parsed.sale_occurred_at };
      }),
      query.day,
    );
  },

  /**
   * How far the register of each platform where one of her accounts is linked has been read (ADR 0054): a day not read
   * is never a day without a sale. Empty while none of her accounts is linked. Agency facts with no secret, readable in
   * any transaction (the cursors are out of RLS).
   */
  readingsOf: async (tx: Transaction, creatorId: CreatorId): Promise<readonly SalesFeedReading[]> => {
    const result = await tx.execute(sql`
      select m.platform, c.read_at, c.paused_until
        from (select distinct platform from sales_feed_models where creator_id = ${creatorId}::uuid) m
        left join sales_feed_cursors c on c.platform = m.platform
       order by m.platform`);
    return result.rows.map((row) => {
      const parsed = ReadingSchema.parse(row);
      return {
        platform: parsed.platform,
        readAt: parsed.read_at?.toISOString() ?? null,
        pausedUntil: parsed.paused_until?.toISOString() ?? null,
      };
    });
  },
};
