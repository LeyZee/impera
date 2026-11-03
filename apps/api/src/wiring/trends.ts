import type { LlmGateway } from '@impera/llm';

import { createTrendsModule, type TrendsModule } from '../modules/trends';

import type { Routes, Shared } from './shared';

export interface WiredTrends {
  readonly module: TrendsModule;
  readonly routes: readonly Routes[];
}

/** The trend watch (VEI-01): its routes, the vision of a marked post's captures on the app's gateway; no job yet. */
export function wireTrends(shared: Shared, gateway: Pick<LlmGateway, 'describeTrendCaptures'>): WiredTrends {
  const module = createTrendsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    gateway,
  });
  return { module, routes: [module.routes] };
}
