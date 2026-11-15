import { PlatformAccountIdSchema, type CreatorId } from '@impera/contracts';
import { onCreatorList, sql, withTenantMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import {
  readsCreatorFigures,
  type ConnectorReadsStore,
  type FiguresReader,
} from '../../domain/connector-reads';

import { dailyStatsOf } from './daily-stats-store';
import { salesFeedTotals } from './totals-reads';

const NameSchema = z.object({ id: z.string(), display_name: z.string() });

/** The reader as his transaction sees him: his scope, and whether the creator is on his list. */
export async function readerIn(
  tx: Transaction,
  userId: string,
  creatorId: CreatorId,
  scope: FiguresReader['scope'],
): Promise<FiguresReader> {
  return { scope, onList: await onCreatorList(tx, userId, creatorId) };
}

/**
 * The connectors' reads for another module's adapter (ADR 0026 § 1): each in the reader's own `withTenantMember`,
 * the rule of `readsCreatorFigures` checked first in that transaction, then the tables' policies on top of it.
 */
export function createDrizzleConnectorReadsStore(db: Database): ConnectorReadsStore {
  return {
    sales: (userId, creatorId, range) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsCreatorFigures(await readerIn(tx, userId, creatorId, scope))) return null;
        const totals = await salesFeedTotals.totalsOf(tx, { creatorId, from: range.from, to: range.to });
        const readings = await salesFeedTotals.readingsOf(tx, creatorId);
        const members = await tx.execute(sql`select id, display_name from team_members`);
        const names = new Map(
          z
            .array(NameSchema)
            .parse(members.rows)
            .map((row) => [row.id, row.display_name] as const),
        );
        return { totals, readings, names };
      }),

    dailyStats: (userId, creatorId, range) =>
      withTenantMember(db, creatorId, userId, async (tx, scope) => {
        if (!readsCreatorFigures(await readerIn(tx, userId, creatorId, scope))) return null;
        const days = await dailyStatsOf(tx, range);
        return days.map((day) => ({
          platform: day.platform,
          platformAccountId: PlatformAccountIdSchema.parse(day.platformAccountId),
          day: day.day,
          newSubscribers: day.newSubscribers,
          unsubscribes: day.unsubscribes,
          activeSubscribers: day.activeSubscribers,
          renewals: day.renewals,
          ppvSent: day.ppvSent,
          ppvPurchased: day.ppvPurchased,
          messagesSent: day.messagesSent,
          messagesReceived: day.messagesReceived,
          readAt: day.readAt.toISOString(),
        }));
      }),
  };
}
