import {
  calendarDayAt,
  CurrencySchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleEventSchema,
  SaleTypeSchema,
  TeamMemberIdSchema,
  type Currency,
  type Platform,
  type PlatformAccountId,
  type SaleEvent,
  type SaleType,
  type TeamMemberId,
} from '@nirvana/contracts';
import { sql, type Transaction } from '@nirvana/db';
import { z } from 'zod';

/**
 * @public
 * Whose a line of the register is, by the owner's link of its platform chatter (ADR 0050 § 5): a member, the agent
 * (the platform's bot, no commission), a chatter nobody linked yet, or no chatter at all. `linkVersion` changes
 * whenever the link points elsewhere: pay freezes it in a statement's inputs.
 */
export type PaySaleAuthor =
  | {
      readonly kind: 'member';
      readonly memberId: TeamMemberId;
      readonly platformChatterId: string;
      readonly linkVersion: string;
    }
  | { readonly kind: 'agent'; readonly platformChatterId: string; readonly linkVersion: string }
  | { readonly kind: 'unlinked'; readonly platformChatterId: string }
  | { readonly kind: 'none' };

/** A line of the register as pay reads it (CRM-03): one sale or one refund, never a sum. */
export interface PaySaleLine {
  readonly platform: Platform;
  /** With `event`, the line's key at the platform: a sale and its refund share the id. */
  readonly platformSaleId: string;
  readonly event: SaleEvent;
  readonly saleType: SaleType;
  readonly platformAccountId: PlatformAccountId;
  /** When the line happened: a sale's instant, or the refund's own. */
  readonly occurredAt: Date;
  /** The sale's instant, a refund's too; `null` for a refund whose sale is older than the register. */
  readonly saleOccurredAt: Date | null;
  /** `saleOccurredAt`'s day in the time zone the caller gives (the agency's), `null` with it. */
  readonly saleDay: string | null;
  /** When Nirvana recorded the line: after a period's closing, the line is late (ADR 0032, ADR 0050 § 7). */
  readonly recordedAt: Date;
  readonly currency: Currency;
  /**
   * The platform's net in minor units (`netAmount`, agency's share plus the creator's), signed: a refund takes off
   * what its sale gave, so it is negative.
   */
  readonly netMinor: number;
  readonly author: PaySaleAuthor;
}

/** Which lines a read takes: the accounts, and a range `[from, to)` of instants. */
export interface PaySalesRange {
  readonly platformAccountIds: readonly PlatformAccountId[];
  readonly from: Date;
  readonly to: Date;
  /** The zone `saleDay` is read in: the agency's. */
  readonly timeZone: string;
}

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));

const RowSchema = z.object({
  platform: PlatformSchema,
  platform_sale_id: z.string(),
  event: SaleEventSchema,
  sale_type: SaleTypeSchema,
  platform_account_id: PlatformAccountIdSchema,
  occurred_at: instant,
  sale_occurred_at: instant.nullable(),
  recorded_at: instant,
  currency: CurrencySchema,
  net_minor: z.coerce.number().int(),
  platform_chatter_id: z.string().nullable(),
  kind: z.enum(['member', 'agent']).nullable(),
  member_id: TeamMemberIdSchema.nullable(),
  link_version: z.string().nullable(),
});
type Row = z.infer<typeof RowSchema>;

function authorOf(row: Row): PaySaleAuthor {
  if (row.platform_chatter_id === null) return { kind: 'none' };
  const platformChatterId = row.platform_chatter_id;
  if (row.kind === 'member' && row.member_id !== null && row.link_version !== null) {
    return { kind: 'member', memberId: row.member_id, platformChatterId, linkVersion: row.link_version };
  }
  if (row.kind === 'agent' && row.link_version !== null) {
    return { kind: 'agent', platformChatterId, linkVersion: row.link_version };
  }
  return { kind: 'unlinked', platformChatterId };
}

function lineOf(row: Row, timeZone: string): PaySaleLine {
  return {
    platform: row.platform,
    platformSaleId: row.platform_sale_id,
    event: row.event,
    saleType: row.sale_type,
    platformAccountId: row.platform_account_id,
    occurredAt: row.occurred_at,
    saleOccurredAt: row.sale_occurred_at,
    saleDay: row.sale_occurred_at === null ? null : calendarDayAt(row.sale_occurred_at, timeZone),
    recordedAt: row.recorded_at,
    currency: row.currency,
    netMinor: row.event === 'refund' ? -row.net_minor : row.net_minor,
    author: authorOf(row),
  };
}

/** Each line with its sale's instant and its chatter's link, for the accounts and the condition given. */
async function read(
  tx: Transaction,
  range: PaySalesRange,
  condition: ReturnType<typeof sql>,
): Promise<PaySaleLine[]> {
  if (range.platformAccountIds.length === 0) return [];
  const result = await tx.execute(sql`
    select l.platform, l.platform_sale_id, l.event, l.sale_type, l.platform_account_id, l.occurred_at,
           case when l.event = 'sale' then l.occurred_at else s.occurred_at end as sale_occurred_at,
           l.recorded_at, l.currency, l.net_minor, l.platform_chatter_id, c.kind, c.member_id, c.link_version
      from platform_sales l
      left join platform_sales s
        on l.event = 'refund' and s.event = 'sale' and s.platform = l.platform and s.platform_sale_id = l.platform_sale_id
      left join sales_feed_chatters c
        on c.platform = l.platform and c.platform_chatter_id = l.platform_chatter_id
     where l.platform_account_id in (${sql.join(
       range.platformAccountIds.map((one) => sql`${one}`),
       sql`, `,
     )})
       and ${condition}
     order by coalesce(case when l.event = 'sale' then l.occurred_at else s.occurred_at end, l.occurred_at),
              l.platform_sale_id, l.event = 'refund'`);
  return result.rows.map((row) => lineOf(RowSchema.parse(row), range.timeZone));
}

/**
 * What pay reads of the sales feed (ADR 0050 §§ 5, 7 and 8; CRM-03), in the caller's transaction, through the
 * connectors' `index.ts`: the register's lines, one by one, with their author by the owner's link and its version.
 * The register is under the creators' RLS: the recalculation job reads it as the admin role, a member's screen in
 * their own scope. Nothing here sums, attributes to a shift or applies a rate: pay does (ADR 0047 § 1).
 */
export const salesFeedReadsForPay = {
  /**
   * The lines whose sale happened in `[from, to)`: the sales, and the refunds of those sales whenever they came, a
   * refund counting on its sale's day (ADR 0050 § 7). A refund whose sale is older than the register counts on its
   * own instant, with `saleOccurredAt` and `saleDay` at `null`.
   */
  linesOfSalesBetween: (tx: Transaction, range: PaySalesRange): Promise<PaySaleLine[]> =>
    read(
      tx,
      range,
      sql`coalesce(case when l.event = 'sale' then l.occurred_at else s.occurred_at end, l.occurred_at) >= ${range.from}
      and coalesce(case when l.event = 'sale' then l.occurred_at else s.occurred_at end, l.occurred_at) < ${range.to}`,
    ),

  /**
   * The lines Nirvana recorded in `[from, to)`, whatever their sale's day: after a period's closing, its late sales
   * and refunds, which count in the first period still open (ADR 0032, ADR 0050 §§ 5 and 7).
   */
  linesRecordedBetween: (tx: Transaction, range: PaySalesRange): Promise<PaySaleLine[]> =>
    read(tx, range, sql`l.recorded_at >= ${range.from} and l.recorded_at < ${range.to}`),
};
