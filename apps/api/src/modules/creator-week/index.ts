/** Public entry point of the `creator-week` module (ADR 0140, her week). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { WeekAgendaStore } from '../creator-tasks';

import { planWeeks, type PlanWeeksRun } from './application/plan-weeks';
import type { AcceptSuggestion, WeekFactsReader } from './domain/ports';
import { createDrizzleDayTickStore } from './infra/db/day-store';
import { createDrizzleWeekDraftStore } from './infra/db/draft-store';
import { createWeekRoutes, type RequireRole } from './infra/http/routes';

export type { WeekFactsReader } from './domain/ports';

export interface CreatorWeekModule {
  readonly name: 'creator-week';
  /** Mounted under `/v1`: the owner's `/creators/:creatorId/weeks/:week`, her `/creator-space/week`, its lines, her day. */
  readonly routes: FastifyPluginAsyncZod;
  readonly jobs: {
    /** `creator_week.plan`, each hour: the week after computed as a draft for each creator whose Sunday 18 h passed. */
    plan(now: Date): Promise<PlanWeeksRun>;
  };
}

export interface CreatorWeekDeps {
  /** Application role: the owner's validation and her team's reads. */
  readonly db: Database;
  /** Owner role: the job's drafts. */
  readonly adminDb: Database;
  readonly requireRole: RequireRole;
  /** Her agenda's door (`creator-tasks`): the frames of her week, her lines, her acceptance. */
  readonly agenda: WeekAgendaStore;
  readonly accept: AcceptSuggestion;
  /** Her stock, her scripts asked, her shooting days and dispos, her delivery: plugged by the composition root. */
  readonly facts: WeekFactsReader;
  /** Tests only: another clock than the server's. */
  readonly clock?: () => Date;
}

export function createCreatorWeekModule(deps: CreatorWeekDeps): CreatorWeekModule {
  const drafts = createDrizzleWeekDraftStore(deps.db, deps.adminDb);
  return {
    name: 'creator-week',
    routes: createWeekRoutes({
      drafts,
      days: createDrizzleDayTickStore(deps.db),
      agenda: deps.agenda,
      accept: deps.accept,
      facts: deps.facts,
      requireRole: deps.requireRole,
      ...(deps.clock !== undefined && { clock: deps.clock }),
    }),
    jobs: { plan: (now) => planWeeks({ drafts, facts: deps.facts }, now) },
  };
}
