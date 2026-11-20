/** Public entry point of the `custom-orders` module (ADR 0159). Other modules import this file only. */
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createDrizzleCustomPriceGridStore } from './infra/db/grid-store';
import { createCustomPriceRoutes, type RequireRole } from './infra/http/routes';

export interface CustomOrdersModule {
  readonly name: 'custom-orders';
  /** Mounted under `/v1`: `/creators/:creatorId/custom-prices`, the owner's alone. */
  readonly routes: FastifyPluginAsyncZod;
}

export interface CustomOrdersDeps {
  /** Application role: the owner reads her grid under her RLS. */
  readonly db: Database;
  /** Service role: the table has no write policy, a save goes through it after the owner's check. */
  readonly requireRole: RequireRole;
}

export function createCustomOrdersModule(deps: CustomOrdersDeps): CustomOrdersModule {
  const store = createDrizzleCustomPriceGridStore(deps.db);
  return { name: 'custom-orders', routes: createCustomPriceRoutes(store, deps.requireRole) };
}
