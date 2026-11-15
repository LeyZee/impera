/** Public entry point of the `rewards` module (ADR 0104 § 12 to § 20, CHF-01). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { evaluateRewards, markRevealed, myTrophyCase, type RewardsDeps } from './application/rewards';
import { createRewardsRoutes, type RewardsRoutesOptions } from './infra/routes';
import { createDrizzleRewardsStore, type RewardsReads } from './infra/store';

/** @public What the game reads of pay and of the planning, plugged by the composition root. */
export type { RewardsReads } from './infra/store';

export interface RewardsModule {
  readonly name: 'rewards';
  readonly jobs: {
    /** What each chatter earned since the last run; replayable. */
    readonly evaluate: () => Promise<{ players: number; gained: number }>;
  };
  /** `/v1/rewards/my-trophy-case` and its reveals, behind the guard given here. */
  readonly routes: (options: RewardsRoutesOptions) => FastifyPluginAsyncZod;
}

export interface RewardsStartOptions {
  /** The application role: an account reads its own gains and marks their reveal. */
  readonly db: Database;
  /** The admin role: the job reads every chatter's facts and is the only writer of a gain. */
  readonly adminDb: Database;
  readonly reads: RewardsReads;
  /** Tests only. */
  readonly now?: () => Date;
}

export function startRewardsModule(options: RewardsStartOptions): RewardsModule {
  const deps: RewardsDeps = {
    store: createDrizzleRewardsStore(options.db, options.adminDb, options.reads),
    now: options.now ?? (() => new Date()),
  };
  return {
    name: 'rewards',
    jobs: { evaluate: () => evaluateRewards(deps) },
    routes: (routeOptions) =>
      createRewardsRoutes(
        {
          myTrophyCase: (userId) => myTrophyCase(deps, userId),
          markRevealed: (userId, body) => markRevealed(deps, userId, body),
        },
        routeOptions,
      ),
  };
}
