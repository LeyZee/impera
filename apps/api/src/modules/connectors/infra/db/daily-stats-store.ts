import { PlatformSchema, type Platform } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { DailyStatsStore, LinkedAccount } from '../../domain/daily-stats';

const { creators, platformDailyStats, salesFeedCursors, salesFeedModels, salesFeedStatsCalls } = schema;

/**
 * The photo of the daily statistics and the calls counted (ADR 0081), through `withAdmin` only: `nirvana_app` has no
 * write policy on either table, and reads the photo inside `withTenantMember` (`dailyStatsOf`).
 */
export function createDrizzleDailyStatsStore(adminDb: Database): DailyStatsStore {
  return {
    fullReadAt: (platform) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ at: salesFeedCursors.statsFullReadAt })
          .from(salesFeedCursors)
          .where(eq(salesFeedCursors.platform, platform));
        return row?.at ?? null;
      }),

    callsOn: (platform, day) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .select({ calls: salesFeedStatsCalls.calls })
          .from(salesFeedStatsCalls)
          .where(and(eq(salesFeedStatsCalls.platform, platform), eq(salesFeedStatsCalls.day, day)));
        return row?.calls ?? 0;
      }),

    countCall: (platform, day) =>
      withAdmin(adminDb, async (tx) => {
        const [row] = await tx
          .insert(salesFeedStatsCalls)
          .values({ platform, day, calls: 1 })
          .onConflictDoUpdate({
            target: [salesFeedStatsCalls.platform, salesFeedStatsCalls.day],
            set: { calls: sql`${salesFeedStatsCalls.calls} + 1` },
          })
          .returning({ calls: salesFeedStatsCalls.calls });
        return row?.calls ?? 1;
      }),

    links: (platform) =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({
            platformModelId: salesFeedModels.platformModelId,
            platformAccountId: salesFeedModels.platformAccountId,
            creatorId: salesFeedModels.creatorId,
          })
          .from(salesFeedModels)
          .innerJoin(creators, eq(creators.id, salesFeedModels.creatorId))
          // An archived creator leaves the reading, as she leaves the agency's Dashboard (ADR 0078).
          .where(and(eq(salesFeedModels.platform, platform), sql`${creators.archivedAt} is null`));
        return new Map<string, LinkedAccount>(
          rows.map((row) => [
            row.platformModelId,
            { platformAccountId: row.platformAccountId, creatorId: row.creatorId },
          ]),
        );
      }),

    record: (platform, rows, readAt, full) =>
      withAdmin(adminDb, async (tx) => {
        for (const row of rows) {
          const values = {
            newSubscribers: row.newSubscribers,
            unsubscribes: row.unsubscribes,
            activeSubscribers: row.activeSubscribers,
            renewals: row.renewals,
            ppvSent: row.ppvSent,
            ppvPurchased: row.ppvPurchased,
            messagesSent: row.messagesSent,
            messagesReceived: row.messagesReceived,
            readAt,
          };
          await tx
            .insert(platformDailyStats)
            .values({
              platform: row.platform,
              platformAccountId: row.platformAccountId,
              creatorId: row.creatorId,
              day: row.day,
              ...values,
            })
            .onConflictDoUpdate({
              target: [platformDailyStats.platformAccountId, platformDailyStats.day],
              // The platform's last word on the day (§ 1), its creator included should the model move.
              set: { creatorId: row.creatorId, ...values },
            });
        }
        if (full) {
          await tx
            .insert(salesFeedCursors)
            .values({ platform, statsFullReadAt: readAt })
            .onConflictDoUpdate({ target: salesFeedCursors.platform, set: { statsFullReadAt: readAt } });
        }
      }),
  };
}

/** A day of the photo as the Dashboard reads it (ADR 0081 § 4): counters only, with the time of their reading. */
export interface DailyStatsDay {
  readonly platform: Platform;
  readonly platformAccountId: string;
  readonly day: string;
  readonly newSubscribers: number;
  readonly unsubscribes: number | null;
  readonly activeSubscribers: number;
  readonly renewals: number | null;
  readonly ppvSent: number | null;
  readonly ppvPurchased: number;
  readonly messagesSent: number | null;
  readonly messagesReceived: number | null;
  readonly readAt: Date;
}

/**
 * The photo of the creator the caller's transaction is in (`withTenantMember`), from `from` to `to` included, by day:
 * the policy shows it to the owner, or to an active manager when she is on his list (ADR 0081 § 5), nobody else.
 */
export async function dailyStatsOf(
  tx: Transaction,
  range: { readonly from: string; readonly to: string },
): Promise<DailyStatsDay[]> {
  const rows = await tx
    .select({
      platform: platformDailyStats.platform,
      platformAccountId: platformDailyStats.platformAccountId,
      day: platformDailyStats.day,
      newSubscribers: platformDailyStats.newSubscribers,
      unsubscribes: platformDailyStats.unsubscribes,
      activeSubscribers: platformDailyStats.activeSubscribers,
      renewals: platformDailyStats.renewals,
      ppvSent: platformDailyStats.ppvSent,
      ppvPurchased: platformDailyStats.ppvPurchased,
      messagesSent: platformDailyStats.messagesSent,
      messagesReceived: platformDailyStats.messagesReceived,
      readAt: platformDailyStats.readAt,
    })
    .from(platformDailyStats)
    .where(sql`${platformDailyStats.day} between ${range.from} and ${range.to}`)
    .orderBy(platformDailyStats.day, platformDailyStats.platformAccountId);
  return rows.map((row) => ({ ...row, platform: PlatformSchema.parse(row.platform) }));
}
