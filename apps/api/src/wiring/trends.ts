import { JOB_PAYLOADS, asPersonaV2 } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import { defineTask } from '../jobs';
import type { ContentDropsModule } from '../modules/content-drops';
import type { CreatorTasksModule } from '../modules/creator-tasks';
import type { PersonaModule } from '../modules/persona';
import { createTrendsModule, type TrendsModule } from '../modules/trends';

import type { Routes, Shared, TasksNamed } from './shared';

export interface WiredTrends {
  readonly module: TrendsModule;
  /** The agenda announces her gesture, content drops her drop; the trend watch is the one that listens (VEI-01 d2, d3). */
  readonly tasks: TasksNamed<'creator_tasks.suggestion_decided' | 'content_drops.drop_received'>;
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
    limitsOf: async (creatorId) => {
      const active = await deps.persona.versions.active(creatorId);
      // Her strict rules, wherever the format keeps them (ADR 0079 § 4).
      return active === null ? null : asPersonaV2(active.persona).agent.rules;
    },
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
      'content_drops.drop_received': defineTask(
        'content_drops.drop_received',
        JOB_PAYLOADS['content_drops.drop_received'],
        shared.logger,
        (payload) => module.jobs.followDeposit(payload),
      ),
    },
    routes: [module.routes],
  };
}
