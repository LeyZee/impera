import { createCreatorLimitsModule, type CreatorLimitsModule } from '../modules/creator-limits';

import type { Routes, Shared } from './shared';

/** Her absences and what she no longer does (Charles, 21/11): hers to tell, her team's to read. A leaf. */
export function wireCreatorLimits(shared: Shared): {
  readonly module: CreatorLimitsModule;
  readonly routes: readonly Routes[];
} {
  const module = createCreatorLimitsModule({ db: shared.db, requireRole: shared.requireRole });
  return { module, routes: [module.routes] };
}
