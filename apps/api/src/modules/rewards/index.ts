/**
 * Public entry point of the `rewards` module (ADR 0104 § 12 to § 20, CHF-01; ADR 0107, CRB-01). Other modules import
 * this file only.
 */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import {
  creatorTrophyCaseForAgency,
  evaluateCreatorRewards,
  herTrophyCase,
  markHerRevealed,
  type CreatorRewardsDeps,
} from './application/creator-rewards';
import { evaluateRewards, markRevealed, myTrophyCase, type RewardsDeps } from './application/rewards';
import { createDrizzleCreatorRewardsStore, type CreatorRewardsReads } from './infra/creator-store';
import { createRewardsRoutes, type RewardsRoutesOptions } from './infra/routes';
import { createDrizzleRewardsStore, type RewardsReads } from './infra/store';

/** @public What the game reads of pay and of the planning, plugged by the composition root. */
export type { RewardsReads } from './infra/store';
/** @public What the creator's game reads of her agenda and her drops, plugged by the composition root. */
export type { CreatorRewardsReads } from './infra/creator-store';

export interface RewardsModule {
  readonly name: 'rewards';
  readonly jobs: {
    /** What each chatter and each creator earned since the last run; replayable. */
    readonly evaluate: () => Promise<{ players: number; gained: number }>;
  };
  /** The chatter's case, the creator's own, and hers on her profile, behind the guards given here. */
  readonly routes: (options: RewardsRoutesOptions) => FastifyPluginAsyncZod;
}

export interface RewardsStartOptions {
  /** The application role: an account reads its own gains and marks their reveal. */
  readonly db: Database;
  /** The admin role: the job reads every player's facts and is the only writer of a gain. */
  readonly adminDb: Database;
  readonly reads: RewardsReads;
  readonly creatorReads: CreatorRewardsReads;
  /** Tests only. */
  readonly now?: () => Date;
}

export function startRewardsModule(options: RewardsStartOptions): RewardsModule {
  const now = options.now ?? (() => new Date());
  const deps: RewardsDeps = {
    store: createDrizzleRewardsStore(options.db, options.adminDb, options.reads),
    now,
  };
  const creatorDeps: CreatorRewardsDeps = {
    creators: createDrizzleCreatorRewardsStore(options.db, options.adminDb, options.creatorReads),
    store: deps.store,
    now,
  };
  return {
    name: 'rewards',
    jobs: {
      evaluate: async () => {
        const team = await evaluateRewards(deps);
        const creators = await evaluateCreatorRewards(creatorDeps);
        return { players: team.players + creators.players, gained: team.gained + creators.gained };
      },
    },
    routes: (routeOptions) =>
      createRewardsRoutes(
        {
          myTrophyCase: (userId) => myTrophyCase(deps, userId),
          markRevealed: (userId, body) => markRevealed(deps, userId, body),
          herTrophyCase: (userId) => herTrophyCase(creatorDeps, userId),
          markHerRevealed: (userId, body) => markHerRevealed(creatorDeps, userId, body),
          creatorTrophyCase: (readerId, creatorId) =>
            creatorTrophyCaseForAgency(creatorDeps, readerId, creatorId),
        },
        routeOptions,
      ),
  };
}
