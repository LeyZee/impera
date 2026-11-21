import { PlatformSchema, type Platform } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withTenantJob, type Database, type Transaction } from '@impera/db';

import type { DailyStatsStore, LinkedAccount } from '../../domain/daily-stats';

const {
  creators,
  platformChatterDailyStats,
  platformDailyStats,
  salesFeedCursors,
  salesFeedModels,
  salesFeedStatsCalls,
} = schema;

/** `rows` by the creator each belongs to, in the order they came. */
function byCreator<Row extends { readonly creatorId: string }>(rows: readonly Row[]): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const group = groups.get(row.creatorId);
    if (group === undefined) groups.set(row.creatorId, [row]);
    else group.push(row);
  }
  return groups;
}

/**
 * The photo of the daily statistics, by account (ADR 0081) and by chatter (ADR 0092 § 1), and the calls counted.
 * The photos are a creator's rows: written under the app role, one creator and one transaction at a time
 * (`withTenantJob`, ADR 0087 lot c), so a day can only land in the creator it is written for. What belongs to the
 * agency (the calls counted, the links, the date of the full reading) stays on the service connection. Accounts read
 * the photos inside `withTenantMember` (`dailyStatsOf`, `chatterStatsOf`) and write nothing.
 */
export function createDrizzleDailyStatsStore(db: Database, adminDb: Database): DailyStatsStore {
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

    record: async (platform, rows, readAt, full) => {
      for (const [creatorId, hers] of byCreator(rows)) {
        await withTenantJob(db, creatorId, 'daily_stats', async (tx) => {
          for (const row of hers) {
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
                creatorId,
                day: row.day,
                ...values,
              })
              .onConflictDoUpdate({
                target: [platformDailyStats.platformAccountId, platformDailyStats.day],
                // The platform's last word on the day (§ 1). An account never changes creator while it has days.
                set: values,
              });
          }
        });
      }
      // Dated once every creator's days are in: a reading cut short is read again in full at the next hour.
      if (full) {
        await withAdmin(adminDb, (tx) =>
          tx
            .insert(salesFeedCursors)
            .values({ platform, statsFullReadAt: readAt })
            .onConflictDoUpdate({ target: salesFeedCursors.platform, set: { statsFullReadAt: readAt } }),
        );
      }
    },

    recordChatters: async (rows, readAt) => {
      for (const [creatorId, hers] of byCreator(rows)) {
        await withTenantJob(db, creatorId, 'daily_stats', async (tx) => {
          for (const row of hers) {
            const values = {
              ppvSent: row.ppvSent,
              ppvPurchased: row.ppvPurchased,
              messagesSent: row.messagesSent,
              readAt,
            };
            await tx
              .insert(platformChatterDailyStats)
              .values({
                platform: row.platform,
                platformAccountId: row.platformAccountId,
                creatorId,
                platformChatterId: row.platformChatterId,
                day: row.day,
                ...values,
              })
              .onConflictDoUpdate({
                target: [
                  platformChatterDailyStats.platformAccountId,
                  platformChatterDailyStats.platformChatterId,
                  platformChatterDailyStats.day,
                ],
                set: values,
              });
          }
        });
      }
    },
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

/** A day of one chatter of the platform on a creator account (ADR 0092 § 1): counters only, with their reading time. */
export interface ChatterStatsDay {
  readonly platform: Platform;
  readonly platformAccountId: string;
  /** The platform's id of its team member's account: the owner's link says who he is in Impera. */
  readonly platformChatterId: string;
  readonly day: string;
  /** `null` while the platform has not computed it yet: « pas encore compté », never 0. */
  readonly ppvSent: number | null;
  readonly ppvPurchased: number;
  readonly messagesSent: number | null;
  readonly readAt: Date;
}

/**
 * The photo by chatter of the creator the caller's transaction is in (`withTenantMember`), from `from` to `to`
 * included, by day then account then chatter: the policy shows it to the owner, or to an active manager when she is on
 * his list, as the photo by account; never to a chatter, his own days included, nor to a creator.
 */
export async function chatterStatsOf(
  tx: Transaction,
  range: { readonly from: string; readonly to: string },
): Promise<ChatterStatsDay[]> {
  const rows = await tx
    .select({
      platform: platformChatterDailyStats.platform,
      platformAccountId: platformChatterDailyStats.platformAccountId,
      platformChatterId: platformChatterDailyStats.platformChatterId,
      day: platformChatterDailyStats.day,
      ppvSent: platformChatterDailyStats.ppvSent,
      ppvPurchased: platformChatterDailyStats.ppvPurchased,
      messagesSent: platformChatterDailyStats.messagesSent,
      readAt: platformChatterDailyStats.readAt,
    })
    .from(platformChatterDailyStats)
    .where(sql`${platformChatterDailyStats.day} between ${range.from} and ${range.to}`)
    .orderBy(
      platformChatterDailyStats.day,
      platformChatterDailyStats.platformAccountId,
      platformChatterDailyStats.platformChatterId,
    );
  return rows.map((row) => ({ ...row, platform: PlatformSchema.parse(row.platform) }));
}
