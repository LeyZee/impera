/** Public entry point of the `custom-orders` module (ADR 0159). Other modules import this file only. */
import type { CreatorId, CustomPriceGrid } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

/** @public The agent's turn on a custom request (ADR 0159 § A.1–A.2 bis); wired by the agent module. */
export { customOrderTurn } from './domain/turn';
/** @public What the agent's turn hands in and gets back. */
export type {
  CustomOrderCard,
  CustomOrderEvent,
  CustomOrderGuard,
  CustomOrderStop,
  CustomOrderTurn,
  CustomOrderTurnInput,
} from './domain/turn';
import { createCustomPriceGridReader, createDrizzleCustomPriceGridStore } from './infra/db/grid-store';
import { createDrizzleCustomOrderStore, type CustomOrderStore } from './infra/db/order-store';
import { createCustomPriceRoutes, type RequireRole } from './infra/http/routes';

/** @public His orders for the agent's turn: read and written in the turn's own transaction, under her RLS. */
export type { CustomOrderRecord, CustomOrderStore } from './infra/db/order-store';

export interface CustomOrdersModule {
  readonly name: 'custom-orders';
  /** Mounted under `/v1`: `/creators/:creatorId/custom-prices`, the owner's alone. */
  readonly routes: FastifyPluginAsyncZod;
  /** Her grid in force for the agent's turn, read as the service role; null when never saved. */
  readonly gridOf: (creatorId: CreatorId) => Promise<CustomPriceGrid | null>;
  /** His open order and what the turn decided about it (ADR 0159 § A), in the turn's transaction. */
  readonly orders: CustomOrderStore;
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
    orders: createDrizzleCustomOrderStore(),
  };
}
