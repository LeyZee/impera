/** Public entry point of the `custom-orders` module (ADR 0159). Other modules import this file only. */
import type { CreatorId, CustomPriceGrid } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

export {
  CUSTOM_ORDER_DECLINE_BRIEF,
  CUSTOM_ORDER_HOLD_BRIEF,
  CUSTOM_ORDER_WAIT_BRIEF,
  customOrderTurn,
  missingDetails,
  type CustomOrderCard,
  type CustomOrderEvent,
  type CustomOrderGuard,
  type CustomOrderStop,
  type CustomOrderTurn,
  type CustomOrderTurnInput,
} from './domain/turn';
import { createCustomPriceGridReader, createDrizzleCustomPriceGridStore } from './infra/db/grid-store';
import { createCustomPriceRoutes, type RequireRole } from './infra/http/routes';

export interface CustomOrdersModule {
  readonly name: 'custom-orders';
  /** Mounted under `/v1`: `/creators/:creatorId/custom-prices`, the owner's alone. */
  readonly routes: FastifyPluginAsyncZod;
  /** Her grid in force for the agent's turn, read as the service role; null when never saved. */
  readonly gridOf: (creatorId: CreatorId) => Promise<CustomPriceGrid | null>;
}

export interface CustomOrdersDeps {
  /** Application role: the owner reads and saves her grid under her RLS. */
  readonly db: Database;
  /** Service role: the agent's turn reads her grid, read only, one creator at a time. */
  readonly adminDb: Database;
  /** The owner's gate on the routes. */
  readonly requireRole: RequireRole;
}

export function createCustomOrdersModule(deps: CustomOrdersDeps): CustomOrdersModule {
  const store = createDrizzleCustomPriceGridStore(deps.db);
  return {
    name: 'custom-orders',
    routes: createCustomPriceRoutes(store, deps.requireRole),
    gridOf: createCustomPriceGridReader(deps.adminDb),
  };
}
