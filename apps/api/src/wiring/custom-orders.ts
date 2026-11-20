import { createCustomOrdersModule, type CustomOrdersModule } from '../modules/custom-orders';

import type { Routes, Shared } from './shared';

/** Her custom orders (ADR 0159), first lot her grid of custom prices: the owner's alone. A leaf: it needs no other module. */
export function wireCustomOrders(shared: Shared): {
  readonly module: CustomOrdersModule;
  readonly routes: readonly Routes[];
} {
  const module = createCustomOrdersModule({
    db: shared.db,
    requireRole: shared.requireRole,
  });
  return { module, routes: [module.routes] };
}
