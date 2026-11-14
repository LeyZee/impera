import {
  LevelThresholdsSchema,
  newId,
  RewardGainIdSchema,
  TeamMemberIdSchema,
  type Currency,
  type TeamMemberId,
} from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { ChallengeShift, TimedNet } from '../domain/challenge';
import type { GamePay, GameShift } from '../domain/gains';
import type { RewardsStore } from '../domain/ports';
import type { Streak } from '../domain/streak';
import { TROPHY_KINDS } from '../domain/trophies';
import type { StoredGain } from '../domain/trophy-case';

const { rewardGains, rewardLevelSettings, rewardStreaks, teamMembers } = schema;

/** What the game reads of the other modules, plugged by the composition root (ADR 0104): read only, never written. */
export interface RewardsReads {
  readonly agencyTimeZone: (tx: Transaction) => Promise<string>;
  readonly payFacts: (
    tx: Transaction,
    memberId: TeamMemberId,
    agencyZone: string,
    now: Date,
  ) => Promise<GamePay & { readonly currency: Currency | null; readonly timedNets: readonly TimedNet[] }>;
  readonly shifts: (tx: Transaction, memberId: TeamMemberId, now: Date) => Promise<GameShift[]>;
  readonly shiftsBegun: (tx: Transaction, memberId: TeamMemberId, now: Date) => Promise<ChallengeShift[]>;
}

const GainKindSchema = z.enum(['tier', 'level', ...TROPHY_KINDS]);
const ThresholdsSchema = LevelThresholdsSchema.shape.thresholdsMinor;

/** The owner's thresholds as stored; a row that no longer reads as thresholds counts as none set. */
async function thresholdsOf(tx: Transaction): Promise<number[]> {
  const [row] = await tx
    .select({ thresholdsMinor: rewardLevelSettings.thresholdsMinor })
    .from(rewardLevelSettings);
  const parsed = ThresholdsSchema.safeParse(row?.thresholdsMinor ?? []);
  return parsed.success ? parsed.data : [];
}

async function gainsAndStreakOf(
  tx: Transaction,
  userId: string,
): Promise<{ gains: StoredGain[]; streak: Streak }> {
  const rows = await tx
    .select({
      kind: rewardGains.kind,
      scopeKey: rewardGains.scopeKey,
      earnedAt: rewardGains.earnedAt,
      revealedAt: rewardGains.revealedAt,
    })
    .from(rewardGains)
    .where(eq(rewardGains.userId, userId))
    .orderBy(rewardGains.earnedAt, rewardGains.kind);
  const [streak] = await tx
    .select({ current: rewardStreaks.current, best: rewardStreaks.best })
    .from(rewardStreaks)
    .where(eq(rewardStreaks.userId, userId));
  const gains: StoredGain[] = rows.map((row) => ({ ...row, kind: GainKindSchema.parse(row.kind) }));
  return { gains, streak: streak ?? { current: 0, best: 0 } };
}

/** The chatters who have not left: who plays (§ 20). */
const plays = and(eq(teamMembers.teamRole, 'chatter'), sql`${teamMembers.status} <> 'left'`);

/**
 * The game's tables (`reward_gains`, `reward_streaks`). The job writes on the admin connection, the only writer of a
 * gain; an account reads its own rows as itself and changes one thing, the date its reveal was played.
 */
export function createDrizzleRewardsStore(
  db: Database,
  adminDb: Database,
  reads: RewardsReads,
): RewardsStore {
  return {
    players: () =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({ memberId: teamMembers.id, userId: teamMembers.userId })
          .from(teamMembers)
          .where(plays)
          .orderBy(teamMembers.id);
        return rows.map((row) => ({ memberId: TeamMemberIdSchema.parse(row.memberId), userId: row.userId }));
      }),

    facts: (player, now) =>
      withAdmin(adminDb, async (tx) => {
        const agencyZone = await reads.agencyTimeZone(tx);
        return {
          agencyZone,
          pay: await reads.payFacts(tx, player.memberId, agencyZone, now),
          shifts: await reads.shifts(tx, player.memberId, now),
          thresholdsMinor: await thresholdsOf(tx),
        };
      }),

    record: (player, gains, streak, now) =>
      withAdmin(adminDb, async (tx) => {
        const written =
          gains.length === 0
            ? []
            : await tx
                .insert(rewardGains)
                .values(
                  gains.map((gain) => ({
                    id: newId(RewardGainIdSchema),
                    userId: player.userId,
                    kind: gain.kind,
                    scopeKey: gain.scopeKey,
                    earnedAt: now,
                  })),
                )
                .onConflictDoNothing({ target: [rewardGains.userId, rewardGains.kind, rewardGains.scopeKey] })
                .returning({ id: rewardGains.id });
        await tx
          .insert(rewardStreaks)
          .values({ userId: player.userId, current: streak.current, best: streak.best, updatedAt: now })
          .onConflictDoUpdate({
            target: rewardStreaks.userId,
            // The best never comes down, even if a shift is cancelled afterwards.
            set: {
              current: streak.current,
              best: sql`greatest(${rewardStreaks.best}, ${streak.best})`,
              updatedAt: now,
            },
          });
        return written.length;
      }),

    // The owner and a manager also read the team's rows (§ 20): this read is the account's own, by its id.
    own: (userId) => withMember(db, userId, (tx) => gainsAndStreakOf(tx, userId)),

    ownFacts: (userId, now) =>
      withMember(db, userId, async (tx) => {
        const [member] = await tx
          .select({ id: teamMembers.id })
          .from(teamMembers)
          .where(and(eq(teamMembers.userId, userId), plays));
        if (member === undefined) return null;
        const memberId = TeamMemberIdSchema.parse(member.id);
        const agencyZone = await reads.agencyTimeZone(tx);
        const pay = await reads.payFacts(tx, memberId, agencyZone, now);
        return {
          agencyZone,
          currency: pay.currency,
          cumulatedNetMinor: pay.cumulatedNetMinor,
          timedNets: pay.timedNets,
          shifts: await reads.shiftsBegun(tx, memberId, now),
          thresholdsMinor: await thresholdsOf(tx),
        };
      }),

    ofMember: (viewerId, memberId) =>
      withMember(db, viewerId, async (tx) => {
        // The database decides who sees the member (the owner and an active manager; anyone their own record).
        const [member] = await tx
          .select({ userId: teamMembers.userId })
          .from(teamMembers)
          .where(and(eq(teamMembers.id, memberId), plays));
        return member === undefined ? null : gainsAndStreakOf(tx, member.userId);
      }),

    thresholds: (userId) => withMember(db, userId, thresholdsOf),

    saveThresholds: (userId, thresholdsMinor, now) =>
      withMember(db, userId, async (tx) => {
        const values = { thresholdsMinor: [...thresholdsMinor], updatedBy: userId, updatedAt: now };
        await tx
          .insert(rewardLevelSettings)
          .values({ singleton: true, ...values })
          .onConflictDoUpdate({ target: rewardLevelSettings.singleton, set: values });
      }),

    markRevealed: (userId, keys, now) =>
      withMember(db, userId, async (tx) => {
        for (const key of keys) {
          await tx
            .update(rewardGains)
            .set({ revealedAt: now })
            .where(
              and(
                eq(rewardGains.userId, userId),
                eq(rewardGains.kind, key.kind),
                eq(rewardGains.scopeKey, key.scopeKey),
                sql`${rewardGains.revealedAt} is null`,
              ),
            );
        }
      }),
  };
}
