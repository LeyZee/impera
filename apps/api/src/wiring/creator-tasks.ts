import { createCreatorTasksModule, type CreatorTasksModule } from '../modules/creator-tasks';

import type { Routes, Shared } from './shared';

export interface WiredCreatorTasks {
  readonly module: CreatorTasksModule;
  readonly routes: readonly Routes[];
}

/** Her agenda (CR-05): no dependency but the shared ones; the time helpers come from `scheduling/pure.ts`. */
export function wireCreatorTasks(shared: Shared): WiredCreatorTasks {
  const module = createCreatorTasksModule({ db: shared.db, requireRole: shared.requireRole });
  return { module, routes: [module.routes] };
}
