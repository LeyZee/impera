import { JOB_PAYLOADS } from '@impera/contracts';

import { defineTask } from '../jobs';
import { payGameFactsUnscoped } from '../modules/payroll';
import { startRewardsModule, type RewardsModule } from '../modules/rewards';
import {
  shiftsForChallengeUnscoped,
  shiftsForGameUnscoped,
  type SchedulingModule,
} from '../modules/scheduling';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredRewards {
  readonly module: RewardsModule;
  readonly tasks: TasksOf<'rewards'>;
  readonly routes: readonly Routes[];
}

/**
 * The chatter's game (ADR 0104 § 12 to § 20) reads a member's pay and planning through the doors of those modules,
 * plugged here, and writes neither: nothing of the game reaches a statement (§ 17).
 */
export function wireRewards(shared: Shared, deps: { readonly scheduling: SchedulingModule }): WiredRewards {
  const { db, adminDb, logger, requireRole } = shared;
  const module = startRewardsModule({
    db,
    adminDb,
    reads: {
      agencyTimeZone: deps.scheduling.pay.agencyTimeZone,
      payFacts: payGameFactsUnscoped,
      shifts: shiftsForGameUnscoped,
      shiftsBegun: shiftsForChallengeUnscoped,
    },
  });
  return {
    module,
    tasks: {
      'rewards.evaluate': defineTask(
        'rewards.evaluate',
        JOB_PAYLOADS['rewards.evaluate'],
        logger,
        async (_payload, context) => {
          const { players, gained } = await module.jobs.evaluate();
          if (gained > 0) context.logger.info({ players, gained }, 'rewards: gains noted');
        },
      ),
    },
    routes: [
      module.routes({
        guard: requireRole('operator'),
        teamGuard: requireRole('owner', 'operator'),
        ownerGuard: requireRole('owner'),
      }),
    ],
  };
}
