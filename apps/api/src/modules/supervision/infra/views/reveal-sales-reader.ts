import type { CreatorId, SalesTotals } from '@nirvana/contracts';
import { sql, withTenantMember, type Database, type Transaction } from '@nirvana/db';
import { z } from 'zod';

import type { RevealSalesView } from '../../domain/dashboard-ports';

/**
 * The connectors' `salesFeedTotals.totalsOf` (CRM-04 lot a), given by the composition root: the one sum of the
 * register, read in the caller's transaction.
 */
export type SalesTotalsOf = (
  tx: Transaction,
  query: { readonly creatorId: CreatorId; readonly from: string; readonly to: string },
) => Promise<SalesTotals>;

const LinkedSchema = z.object({ linked: z.boolean() });
const NameSchema = z.object({ id: z.string(), display_name: z.string() });

/**
 * The sales panel's read (CRM-04 lot c), as the person who reads the Dashboard: inside her tenant (`platform_sales` is
 * under RLS by creator) and with his team scope, so that the members' names come only to the owner and an active
 * manager, whose scope reads the team (ADR 0024); a chatter's scope reads no one's but his own, and gets no seller.
 */
export function createRevealSalesReader(db: Database, totalsOf: SalesTotalsOf): RevealSalesView {
  return {
    read: (creatorId, userId, range) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        const linked = await tx.execute(
          sql`select exists (select 1 from sales_feed_models where creator_id = ${creatorId}::uuid) as linked`,
        );
        if (!LinkedSchema.parse(linked.rows[0]).linked) return undefined;
        const totals = await totalsOf(tx, { creatorId, from: range.from, to: range.to });
        if (scope === 'self') return { totals, names: null };
        const members = await tx.execute(sql`select id, display_name from team_members`);
        const names = new Map(
          z
            .array(NameSchema)
            .parse(members.rows)
            .map((row) => [row.id, row.display_name] as const),
        );
        return { totals, names };
      }),
  };
}
