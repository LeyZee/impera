import { createContentDropsModule, type ContentDropsModule } from '../modules/content-drops';

import type { Routes, Shared } from './shared';

export interface WiredContentDrops {
  readonly module: ContentDropsModule;
  readonly routes: readonly Routes[];
}

/** Her drops and the agency's requests (CR-06): no dependency but the shared ones. */
export function wireContentDrops(shared: Shared): WiredContentDrops {
  const module = createContentDropsModule({ db: shared.db, requireRole: shared.requireRole });
  return { module, routes: [module.routes] };
}
