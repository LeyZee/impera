import { JOB_PAYLOADS } from '@nirvana/contracts';

import { defineTask } from '../jobs';
import { enqueuePayRecalculation } from '../modules/payroll';
import type { PersonaModule } from '../modules/persona';
import { createSchedulingModule, type SchedulingModule } from '../modules/scheduling';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredScheduling {
  readonly module: SchedulingModule;
  readonly tasks: TasksOf<'scheduling'>;
  readonly routes: readonly Routes[];
}

export function wireScheduling(shared: Shared, deps: { readonly persona: PersonaModule }): WiredScheduling {
  const { db, adminDb, logger, requireRole } = shared;
  const module = createSchedulingModule({
    db,
    adminDb,
    creators: { list: () => deps.persona.creators.list('all') },
    // Pay owns `payroll.recalculate`: a validated report enqueues it through pay's own function (EQ-04).
    enqueuePayRecalculation,
  });
  return {
    module,
    tasks: {
      'scheduling.make_shifts': defineTask(
        'scheduling.make_shifts',
        JOB_PAYLOADS['scheduling.make_shifts'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { made: await module.jobs.makeShifts(context.logger) },
            'scheduling: template shifts made',
          );
        },
      ),
      'scheduling.lapse_swaps': defineTask(
        'scheduling.lapse_swaps',
        JOB_PAYLOADS['scheduling.lapse_swaps'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { lapsed: await module.jobs.lapseSwaps() },
            'scheduling: swap proposals lapsed',
          );
        },
      ),
    },
    routes: [module.routes(requireRole)],
  };
}
