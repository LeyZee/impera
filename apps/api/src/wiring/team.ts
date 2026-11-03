import { JOB_PAYLOADS } from '@impera/contracts';

import { liveInvitationLinksUnscoped } from '../invitation-links';
import { defineTask } from '../jobs';
import { enqueuePayRecalculation } from '../modules/payroll';
import type { PersonaModule } from '../modules/persona';
import { createTeamModule, type TeamModule } from '../modules/team';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredTeam {
  readonly module: TeamModule;
  readonly tasks: TasksOf<'team'>;
  readonly routes: readonly Routes[];
}

export function wireTeam(
  shared: Shared,
  deps: {
    readonly persona: PersonaModule;
    /**
     * Tests set the team's clock here, to make a member leave on a day already past and read his closing fortnight
     * (EQ-14); the system's otherwise. A departure is the day it is said: nothing else ever back-dates one.
     */
    readonly now?: () => Date;
  },
): WiredTeam {
  const { db, adminDb, logger, requireRole } = shared;
  const module = createTeamModule({
    db,
    adminDb,
    creators: {
      existing: async (ids) => new Set((await deps.persona.creators.list(ids)).map((creator) => creator.id)),
    },
    // The links' table is read through `withAdmin` only (EQ-10): the module gets this function, never the table.
    invitationLinks: { live: (memberIds) => liveInvitationLinksUnscoped(adminDb, memberIds) },
    enqueuePayRecalculation,
    ...(deps.now !== undefined && { now: deps.now }),
  });
  return {
    module,
    tasks: {
      'team.apply_roles': defineTask(
        'team.apply_roles',
        JOB_PAYLOADS['team.apply_roles'],
        logger,
        async (_payload, context) => {
          context.logger.info({ applied: await module.jobs.applyRoles() }, 'team: roles of the day applied');
        },
      ),
    },
    routes: [module.routes(requireRole)],
  };
}
