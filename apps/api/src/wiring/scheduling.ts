import { JOB_PAYLOADS } from '@impera/contracts';

import { defineTask } from '../jobs';
import { salesFeedSwitchReads, salesFeedTotals } from '../modules/connectors';
import type { CreatorTasksModule } from '../modules/creator-tasks';
import { enqueuePayRecalculation } from '../modules/payroll';
import type { PersonaModule } from '../modules/persona';
import { createSchedulingModule, type SchedulingModule } from '../modules/scheduling';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredScheduling {
  readonly module: SchedulingModule;
  readonly tasks: TasksOf<'scheduling'>;
  readonly routes: readonly Routes[];
}

export function wireScheduling(
  shared: Shared,
  deps: { readonly persona: PersonaModule; readonly creatorTasks: CreatorTasksModule },
): WiredScheduling {
  const { db, adminDb, logger, requireRole } = shared;
  const module = createSchedulingModule({
    db,
    adminDb,
    creators: {
      // The archived ones too, said so (ADR 0071 § 2): the planning keeps her history and refuses her a new shift.
      list: async () => {
        const [all, open] = await Promise.all([
          deps.persona.creators.list('all'),
          deps.persona.creators.unarchived('all'),
        ]);
        const listed = new Set(open.map((creator) => creator.id));
        return all.map((creator) => ({ ...creator, archived: !listed.has(creator.id) }));
      },
    },
    // Pay owns `payroll.recalculate`: a validated report enqueues it through pay's own function (EQ-04).
    enqueuePayRecalculation,
    // The switch guard of the pay rules reads the sales feed's links and checks (ADR 0050 § 8, CRM-03).
    switchFactsOf: salesFeedSwitchReads.switchFactsOf,
    // The agency percentages' check reads the register's totals, the one rule of CRM-04 (lot d3).
    salesTotalsOf: salesFeedTotals.totalsOf,
    // A creator's calendar link shows her agenda (CR-05 lot c2, ADR 0042 § 4), read by her agenda's own module.
    creatorAgendaFeed: deps.creatorTasks.feedOf,
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
      'scheduling.check_agency_shares': defineTask(
        'scheduling.check_agency_shares',
        JOB_PAYLOADS['scheduling.check_agency_shares'],
        logger,
        async (_payload, context) => {
          context.logger.info(
            { published: await module.jobs.checkAgencyShares(`job:${context.jobId}`) },
            'scheduling: agency percentages checked against the register',
          );
        },
      ),
    },
    routes: [module.routes(requireRole)],
  };
}
