import type { LlmGateway } from '@impera/llm';

import type { CreatorTasksModule } from '../modules/creator-tasks';
import type { PersonaModule } from '../modules/persona';
import { createTrendsModule, type TrendsModule } from '../modules/trends';

import type { Routes, Shared } from './shared';

export interface WiredTrends {
  readonly module: TrendsModule;
  readonly routes: readonly Routes[];
}

/**
 * The trend watch (VEI-01): its routes, the vision of a marked post's captures on the app's gateway; after the persona
 * (her limits, ADR 0056 § 1) and her agenda (a validated idea's suggestion, lot d). No job yet.
 */
export function wireTrends(
  shared: Shared,
  deps: {
    readonly gateway: Pick<LlmGateway, 'describeTrendCaptures'>;
    readonly persona: PersonaModule;
    readonly agenda: CreatorTasksModule;
  },
): WiredTrends {
  const module = createTrendsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    gateway: deps.gateway,
    limitsOf: async (creatorId) => (await deps.persona.versions.active(creatorId))?.persona.limits ?? null,
    agenda: deps.agenda,
  });
  return { module, routes: [module.routes] };
}
