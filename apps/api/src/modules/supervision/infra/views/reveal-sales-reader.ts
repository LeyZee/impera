import { PlatformSchema, type CreatorId, type SalesTotals } from '@nirvana/contracts';
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

const LinkedSchema = z.array(z.object({ platform: PlatformSchema }));
const NameSchema = z.object({ id: z.string(), display_name: z.string() });

/**
 * The sales panel's read (CRM-04 lot c), as the person who reads the Dashboard: inside her tenant (`platform_sales` is
 * under RLS by creator) and with his team scope: only the owner and an active manager, whose scope reads the team
 * (ADR 0024), read the panel. A scope of one's own reads nothing of it, not even the totals: taking his own sales off
 * the whole would give him the others' (ADR 0043 § 7). His own sales stay in Commissions.
 */
export function createRevealSalesReader(db: Database, totalsOf: SalesTotalsOf): RevealSalesView {
  return {
    read: (creatorId, userId, range) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (scope === 'self') return undefined;
        const linked = await tx.execute(
          sql`select distinct platform from sales_feed_models where creator_id = ${creatorId}::uuid order by platform`,
        );
        const [first, ...others] = LinkedSchema.parse(linked.rows).map((row) => row.platform);
        if (first === undefined) return undefined;
        const totals = await totalsOf(tx, { creatorId, from: range.from, to: range.to });
        const members = await tx.execute(sql`select id, display_name from team_members`);
        const names = new Map(
          z
            .array(NameSchema)
            .parse(members.rows)
            .map((row) => [row.id, row.display_name] as const),
        );
        return { platforms: [first, ...others], totals, names };
      }),
  };
}
