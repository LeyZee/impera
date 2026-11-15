import { newId, RewardGainIdSchema, TeamMemberIdSchema, type TeamMemberId } from '@impera/contracts';
import { and, eq, schema, sql, withAdmin, withMember, type Database, type Transaction } from '@impera/db';
import { z } from 'zod';

import type { GamePay, GameShift } from '../domain/gains';
import type { RewardsStore } from '../domain/ports';
import { TROPHY_KINDS } from '../domain/trophies';
import type { StoredGain } from '../domain/trophy-case';

const { rewardGains, rewardStreaks, teamMembers } = schema;

/** What the game reads of the other modules, plugged by the composition root (ADR 0104): read only, never written. */
export interface RewardsReads {
  readonly agencyTimeZone: (tx: Transaction) => Promise<string>;
  readonly payFacts: (
    tx: Transaction,
    memberId: TeamMemberId,
    agencyZone: string,
    now: Date,
  ) => Promise<GamePay>;
  readonly shifts: (tx: Transaction, memberId: TeamMemberId, now: Date) => Promise<GameShift[]>;
}

const GainKindSchema = z.enum(['tier', ...TROPHY_KINDS]);

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
          .where(and(eq(teamMembers.teamRole, 'chatter'), sql`${teamMembers.status} <> 'left'`))
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

    own: (userId) =>
      withMember(db, userId, async (tx) => {
        // The owner and a manager also read the team's rows (§ 20): this read is the account's own, by its id.
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
