import { JOB_PAYLOADS } from '@impera/contracts';

import { defineTask } from '../jobs';
import { createFansModule, type FansModule } from '../modules/fans';

import type { Routes, Shared, TasksOf } from './shared';

type KycSlotsOf = NonNullable<Parameters<FansModule['routes']>[1]>;
type FanRoutedTo = NonNullable<Parameters<FansModule['routes']>[2]>;

export interface WiredFans {
  readonly module: FansModule;
  readonly tasks: TasksOf<'fans'>;
  /**
   * Her canvas lines come from the agent, and who holds a fan's conversation from `conversations`, both wired after:
   * the routes are built once they exist.
   */
  routes(kycSlotsOf: KycSlotsOf, fanRoutedTo: FanRoutedTo): Routes;
}

export function wireFans(shared: Shared): WiredFans {
  const { db, adminDb, logger, requireRole } = shared;
  const module = createFansModule({ db, adminDb });
  return {
    module,
    tasks: {
      'fans.purge_facts': defineTask(
        'fans.purge_facts',
        JOB_PAYLOADS['fans.purge_facts'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { removed: await module.jobs.purgeFacts() },
            'fans: facts past retention dropped',
          );
        },
      ),
    },
    routes: (kycSlotsOf, fanRoutedTo) => module.routes(requireRole, kycSlotsOf, fanRoutedTo),
  };
}
