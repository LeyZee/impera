import {
  calendarDayAt,
  CurrencySchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  SaleEventSchema,
  SaleTypeSchema,
  SaleStatusSchema,
  TeamMemberIdSchema,
  type Currency,
  type Platform,
  type PlatformAccountId,
  type SaleEvent,
  type SaleStatus,
  type SaleType,
  type TeamMemberId,
} from '@nirvana/contracts';
import { sql, type Transaction } from '@nirvana/db';
import { z } from 'zod';

/**
 * @public
 * Whose a line of the register is, by the owner's link of its platform chatter (ADR 0050 § 5): a member, the agent
 * (the platform's bot, no commission), a chatter nobody linked yet, or no chatter at all. A refund is its sale's
 * author's. `linkVersion` changes whenever the link points elsewhere, and `linkVersionAt` with it: pay freezes the
 * version in a statement's inputs, and counts a line linked after a closing in the first period still open (§ 5).
 */
export type PaySaleAuthor =
  | {
      readonly kind: 'member';
      readonly memberId: TeamMemberId;
      readonly platformChatterId: string;
      readonly linkVersion: string;
      readonly linkVersionAt: Date;
    }
  | {
      readonly kind: 'agent';
      readonly platformChatterId: string;
      readonly linkVersion: string;
      readonly linkVersionAt: Date;
    }
  | { readonly kind: 'unlinked'; readonly platformChatterId: string }
  | { readonly kind: 'none' };

/** A line of the register as pay reads it (CRM-03): one sale or one refund, never a sum. */
export interface PaySaleLine {
  readonly platform: Platform;
  /** With `event`, the line's key at the platform: a sale and its refund share the id. */
  readonly platformSaleId: string;
  readonly event: SaleEvent;
  readonly saleType: SaleType;
  /**
   * The line's status when it was first read, which it keeps (a line never changes once recorded): `other` is a value
   * the platform added that Nirvana does not know (ADR 0050 § 3), `refund_asked` still counts and is signalled (§ 7).
   */
  readonly status: SaleStatus;
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
  status: SaleStatusSchema,
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
  link_version_at: instant.nullable(),
});
type Row = z.infer<typeof RowSchema>;

function authorOf(row: Row): PaySaleAuthor {
  if (row.platform_chatter_id === null) return { kind: 'none' };
  const platformChatterId = row.platform_chatter_id;
  const { link_version: linkVersion, link_version_at: linkVersionAt } = row;
  if (linkVersion === null || linkVersionAt === null) return { kind: 'unlinked', platformChatterId };
  if (row.kind === 'member' && row.member_id !== null) {
    return { kind: 'member', memberId: row.member_id, platformChatterId, linkVersion, linkVersionAt };
  }
  if (row.kind === 'agent') return { kind: 'agent', platformChatterId, linkVersion, linkVersionAt };
  return { kind: 'unlinked', platformChatterId };
}

function lineOf(row: Row, timeZone: string): PaySaleLine {
  return {
    platform: row.platform,
    platformSaleId: row.platform_sale_id,
    event: row.event,
    saleType: row.sale_type,
    status: row.status,
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

/**
 * A line's chatter: a refund's is its sale's, should the platform ever name another chatter on it, and nobody when the
 * sale had none; the refund's own only when its sale is older than the register.
 */
const chatter = sql`case when l.event = 'refund' and s.platform_sale_id is not null
  then s.platform_chatter_id else l.platform_chatter_id end`;

/** Each line with its sale's instant and its chatter's link, for the accounts and the condition given. */
async function read(
  tx: Transaction,
  range: PaySalesRange,
  condition: ReturnType<typeof sql>,
): Promise<PaySaleLine[]> {
  if (range.platformAccountIds.length === 0) return [];
  const result = await tx.execute(sql`
    select l.platform, l.platform_sale_id, l.event, l.sale_type, l.status, l.platform_account_id, l.occurred_at,
           case when l.event = 'sale' then l.occurred_at else s.occurred_at end as sale_occurred_at,
           l.recorded_at, l.currency, l.net_minor,
           ${chatter} as platform_chatter_id,
           c.kind, c.member_id, c.link_version, c.link_version_at
      from platform_sales l
      left join platform_sales s
        on l.event = 'refund' and s.event = 'sale' and s.platform = l.platform and s.platform_sale_id = l.platform_sale_id
      left join sales_feed_chatters c on c.platform = l.platform and c.platform_chatter_id = ${chatter}
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
 *
 * The reads overlap on purpose: a late refund comes out in its sale's period and in the period it was recorded in, a
 * line linked late in its sale's period and in the period it was linked in. A reader keys the lines by `platform`,
 * `platformSaleId` and `event`, and counts each key once.
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

  /**
   * The lines whose chatter's link got its current version in `[from, to)`, whatever their sale's day: linked, or
   * linked elsewhere, after a period's closing. Linking is an attribution, which counts in the first period still open
   * (ADR 0050 § 5, ADR 0032).
   */
  linesRelinkedBetween: (tx: Transaction, range: PaySalesRange): Promise<PaySaleLine[]> =>
    read(tx, range, sql`c.link_version_at >= ${range.from} and c.link_version_at < ${range.to}`),
};
