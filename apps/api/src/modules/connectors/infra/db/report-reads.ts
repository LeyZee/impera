import { PlatformSchema, type Currency, type PlatformAccountId, type TeamMemberId } from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

/**
 * A feed whose register was not read for this long is cut, not late (ADR 0073 § 7): with a working webhook the reading
 * is an hourly catch-up, so two hours without one is no longer a delay.
 */
const FEED_SILENT_MS = 2 * 60 * 60 * 1000;

/** Which sales a declared report is compared with (ADR 0073 § 2): its shift's account and member, over its window. */
export interface ShiftSalesQuery {
  readonly platformAccountId: PlatformAccountId;
  readonly memberId: TeamMemberId;
  /** The report's: a line in another currency is not its. */
  readonly currency: Currency;
  /** The shift's access window (ADR 0025), `[from, to)`. */
  readonly from: Date;
  readonly to: Date;
  readonly now: Date;
}

/**
 * @public
 * What the platform read for a shift (ADR 0073 § 2 and § 7):
 * - `none`: the agency reads no register on the account's platform, nothing is compared;
 * - `off`: its feed is cut or paused; `model_unlinked`: the account's model is linked to no platform model;
 *   `chatter_unlinked`: the member to no platform chatter;
 * - `read`: the member's sales on the account over the window, gross including VAT, the refunds known so far taken
 *   off, and when a read last reached the end of the register (`null` before any did).
 */
export type ShiftSales =
  | { readonly feed: 'none' | 'off' | 'model_unlinked' | 'chatter_unlinked' }
  | { readonly feed: 'read'; readonly grossInclVatMinor: number; readonly caughtUpAt: Date | null };

const instant = z.union([z.date(), z.string()]).transform((value) => new Date(value));

const CursorSchema = z.object({
  platform: PlatformSchema,
  read_at: instant.nullable(),
  paused_until: instant.nullable(),
  caught_up_at: instant.nullable(),
});

/**
 * @public
 * The sales a declared report is compared with (ADR 0073), read in the caller's transaction through the connectors'
 * `index.ts`: under the actor's policies for a screen (the shift's creator entered), as the admin role for the
 * automatic check's job. A sale is the member's by the owner's link of its platform chatter (ADR 0050 § 5); it counts
 * when it happened in the window, and its refunds come off whenever they were recorded. Nothing here decides a gap:
 * the planning does (`scheduling`).
 */
export const salesFeedReadsForReports = {
  shiftSales: async (tx: Transaction, query: ShiftSalesQuery): Promise<ShiftSales> => {
    const cursors = await tx.execute(sql`
      select c.platform, c.read_at, c.paused_until, c.caught_up_at
        from platform_accounts a
        join sales_feed_cursors c on c.platform = a.platform
       where a.id = ${query.platformAccountId}`);
    const [raw] = cursors.rows;
    if (raw === undefined) return { feed: 'none' };
    const cursor = CursorSchema.parse(raw);
    const linked = await tx.execute(
      sql`select 1 from sales_feed_models where platform_account_id = ${query.platformAccountId}`,
    );
    if (linked.rows.length === 0) return { feed: 'model_unlinked' };
    const silent = cursor.read_at === null || query.now.getTime() - cursor.read_at.getTime() > FEED_SILENT_MS;
    const paused = cursor.paused_until !== null && cursor.paused_until.getTime() > query.now.getTime();
    if (silent || paused) return { feed: 'off' };
    const chatter = await tx.execute(sql`
      select 1 from sales_feed_chatters
       where platform = ${cursor.platform} and kind = 'member' and member_id = ${query.memberId}`);
    if (chatter.rows.length === 0) return { feed: 'chatter_unlinked' };
    const total = await tx.execute(sql`
      select coalesce(sum(l.gross_incl_vat_minor - coalesce(r.refunded, 0)), 0)::bigint as gross
        from platform_sales l
        join sales_feed_chatters c
          on c.platform = l.platform and c.platform_chatter_id = l.platform_chatter_id
         and c.kind = 'member' and c.member_id = ${query.memberId}
        left join lateral (
          select sum(x.gross_incl_vat_minor) as refunded
            from platform_sales x
           where x.event = 'refund' and x.platform = l.platform and x.platform_sale_id = l.platform_sale_id
             and x.creator_id = l.creator_id
        ) r on true
       where l.platform_account_id = ${query.platformAccountId}
         and l.event = 'sale'
         and l.currency = ${query.currency}
         and l.occurred_at >= ${query.from}
         and l.occurred_at < ${query.to}`);
    const { gross } = z.object({ gross: z.coerce.number().int() }).parse(total.rows[0]);
    return { feed: 'read', grossInclVatMinor: gross, caughtUpAt: cursor.caught_up_at };
  },
};
