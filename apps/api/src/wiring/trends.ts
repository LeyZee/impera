import { JOB_PAYLOADS } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import { defineTask } from '../jobs';
import type { ContentDropsModule } from '../modules/content-drops';
import type { CreatorTasksModule } from '../modules/creator-tasks';
import type { PersonaModule } from '../modules/persona';
import { createTrendsModule, type TrendsModule } from '../modules/trends';

import type { Routes, Shared, TasksNamed } from './shared';

export interface WiredTrends {
  readonly module: TrendsModule;
  /** The agenda announces her gesture; the trend watch is the one that listens (VEI-01 d2). */
  readonly tasks: TasksNamed<'creator_tasks.suggestion_decided'>;
  readonly routes: readonly Routes[];
}

/**
 * The trend watch (VEI-01): its routes, the vision of a marked post's captures on the app's gateway; after the persona
 * (her limits, ADR 0056 § 1), her agenda (a validated idea's suggestion, lot d1) and her content requests (the shoot
 * she accepted, lot d2).
 */
export function wireTrends(
  shared: Shared,
  deps: {
    readonly gateway: Pick<LlmGateway, 'describeTrendCaptures'>;
    readonly persona: PersonaModule;
    readonly agenda: CreatorTasksModule;
    readonly contentDrops: ContentDropsModule;
  },
): WiredTrends {
  const module = createTrendsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    gateway: deps.gateway,
    limitsOf: async (creatorId) => (await deps.persona.versions.active(creatorId))?.persona.limits ?? null,
    agenda: deps.agenda,
    contentDrops: deps.contentDrops,
  });
  return {
    module,
    tasks: {
      'creator_tasks.suggestion_decided': defineTask(
        'creator_tasks.suggestion_decided',
        JOB_PAYLOADS['creator_tasks.suggestion_decided'],
        shared.logger,
        (payload) => module.jobs.followDecision(payload),
      ),
    },
    routes: [module.routes],
  };
}
