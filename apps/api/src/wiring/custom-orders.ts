import type { CreatorLimitsModule } from '../modules/creator-limits';
import type { CreatorTasksModule } from '../modules/creator-tasks';
import { createCustomOrdersModule, type CustomOrdersModule } from '../modules/custom-orders';

import type { Routes, Shared } from './shared';

/**
 * Her custom orders (ADR 0159): her grid of custom prices, the owner's alone, and the orders. A cam's slot is looked
 * for in her dispos cam (`creator-tasks`) outside her absence (`creator-limits`).
 */
export function wireCustomOrders(
  shared: Shared,
  deps: { readonly creatorTasks: CreatorTasksModule; readonly creatorLimits: CreatorLimitsModule },
): {
  readonly module: CustomOrdersModule;
  readonly routes: readonly Routes[];
} {
  const module = createCustomOrdersModule({
    db: shared.db,
    adminDb: shared.adminDb,
    requireRole: shared.requireRole,
    camAgenda: {
      room: (creatorId, ask) => deps.creatorTasks.camRoom(creatorId, ask),
      absence: (creatorId, at) => deps.creatorLimits.reads.creatorAbsence(creatorId, at),
    },
  });
  return { module, routes: [module.routes] };
}
