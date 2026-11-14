import { newId, RewardGainIdSchema } from '@impera/contracts';
import {
  and,
  eq,
  NotACreatorAccount,
  schema,
  sql,
  withAdmin,
  withCreatorAccount,
  withMember,
  withTenantMember,
  type Database,
  type Transaction,
} from '@impera/db';
import { z } from 'zod';

import { CREATOR_GAIN_KINDS } from '../domain/creator-game';
import { CreatorTrophiesForbidden } from '../domain/errors';
import type { CreatorRewardsStore } from '../domain/ports';

const { rewardGains, user } = schema;

/** What the creator's game reads of her agenda and her drops, plugged by the composition root (ADR 0107): read only. */
export interface CreatorRewardsReads {
  readonly days: (
    tx: Transaction,
    creatorId: string,
    now: Date,
  ) => Promise<{
    readonly today: string;
    readonly current: number;
    readonly best: number;
    readonly perfectDay: boolean;
  }>;
  readonly drops: (
    tx: Transaction,
    creatorId: string,
    userId: string,
  ) => Promise<{
    readonly requests: readonly {
      readonly dueOn: string;
      readonly state: 'open' | 'refused' | 'cancelled';
      readonly decidedOn: string | null;
      readonly arrivedOn: string | null;
    }[];
    readonly firstDrop: boolean;
    readonly firstScript: boolean;
  }>;
}

const CreatorGainKindSchema = z.enum(CREATOR_GAIN_KINDS);

/** Her account, the one `creator` account linked to her creator, on the admin connection. */
async function accountOf(tx: Transaction, creatorId: string): Promise<string | null> {
  const [account] = await tx
    .select({ id: user.id })
    .from(user)
    .where(and(eq(user.role, 'creator'), sql`${user.creatorIds} = array[${creatorId}]::uuid[]`));
  return account?.id ?? null;
}

/**
 * The creator's side of the game's table `reward_gains` (ADR 0107 § 13): the job writes on the admin connection, the
 * only writer of a gain; her gains are read under the table's policies, by her or by the owner or an active manager.
 * Her streaks are never stored: they are counted again from her days and her requests at each read.
 */
export function createDrizzleCreatorRewardsStore(
  db: Database,
  adminDb: Database,
  reads: CreatorRewardsReads,
): CreatorRewardsStore {
  return {
    players: () =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({ userId: user.id, creatorIds: user.creatorIds })
          .from(user)
          .where(and(eq(user.role, 'creator'), sql`cardinality(${user.creatorIds}) = 1`))
          .orderBy(user.id);
        return rows.flatMap((row) => {
          const [creatorId] = row.creatorIds;
          return creatorId === undefined ? [] : [{ userId: row.userId, creatorId }];
        });
      }),

    facts: (player, now) =>
      withAdmin(adminDb, async (tx) => {
        const days = await reads.days(tx, player.creatorId, now);
        const drops = await reads.drops(tx, player.creatorId, player.userId);
        return {
          dayStreak: { current: days.current, best: days.best },
          perfectDay: days.perfectDay,
          requests: drops.requests,
          today: days.today,
          firstDrop: drops.firstDrop,
          firstScript: drops.firstScript,
          // Neither signal exists yet (ADR 0055 § 5 stock, ADR 0044 § 4 « à refaire »): the trophies wait for them.
          fullStock: null,
          hitContent: null,
        };
      }),

    record: (player, gains, now) =>
      withAdmin(adminDb, async (tx) => {
        if (gains.length === 0) return 0;
        const written = await tx
          .insert(rewardGains)
          .values(
            gains.map((kind) => ({
              id: newId(RewardGainIdSchema),
              userId: player.userId,
              kind,
              scopeKey: '',
              earnedAt: now,
            })),
          )
          .onConflictDoNothing({ target: [rewardGains.userId, rewardGains.kind, rewardGains.scopeKey] })
          .returning({ id: rewardGains.id });
        return written.length;
      }),

    herself: async (userId) => {
      try {
        return await withCreatorAccount(db, userId, (_tx, creatorId) =>
          Promise.resolve({ userId, creatorId }),
        );
      } catch (error) {
        if (error instanceof NotACreatorAccount) throw new CreatorTrophiesForbidden();
        throw error;
      }
    },

    forAgency: async (readerId, creatorId) => {
      const reads = await withTenantMember(db, creatorId, readerId, (_tx, scope) =>
        Promise.resolve(scope === 'owner' || scope === 'agency'),
      );
      if (!reads) return null;
      const userId = await withAdmin(adminDb, (tx) => accountOf(tx, creatorId));
      return userId === null ? null : { userId, creatorId };
    },

    gains: (readerId, player) =>
      withMember(db, readerId, async (tx) => {
        const rows = await tx
          .select({
            kind: rewardGains.kind,
            earnedAt: rewardGains.earnedAt,
            revealedAt: rewardGains.revealedAt,
          })
          .from(rewardGains)
          .where(eq(rewardGains.userId, player.userId))
          .orderBy(rewardGains.earnedAt, rewardGains.kind);
        // A kind of the chatter's game on her account cannot be: the job writes hers alone. Skipped, never thrown.
        return rows.flatMap((row) => {
          const kind = CreatorGainKindSchema.safeParse(row.kind);
          return kind.success
            ? [{ kind: kind.data, earnedAt: row.earnedAt, revealedAt: row.revealedAt }]
            : [];
        });
      }),
  };
}
