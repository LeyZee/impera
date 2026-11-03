import { createTrendsModule, type TrendsModule } from '../modules/trends';

import type { Routes, Shared } from './shared';

export interface WiredTrends {
  readonly module: TrendsModule;
  readonly routes: readonly Routes[];
}

/** The trend watch (VEI-01 lot b): its routes only, no job yet (lots c and d). */
export function wireTrends(shared: Shared): WiredTrends {
  const module = createTrendsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
  });
  return { module, routes: [module.routes] };
}
