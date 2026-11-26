/** Public entry point of the `custom-orders` module (ADR 0159). Other modules import this file only. */
import type { CreatorId, CustomPriceGrid } from '@impera/contracts';
import { withTenant, type Database } from '@impera/db';
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
import { camSlotOf, type CamSlot } from './domain/cam';
import { bookedCams, createDrizzleCustomOrderAgencyStore, type CamAgenda } from './infra/db/agency-store';
import { createCustomPriceGridReader, createDrizzleCustomPriceGridStore } from './infra/db/grid-store';
import { createDrizzleCustomOrderStore, type CustomOrderStore } from './infra/db/order-store';
import { createCustomOrderRoutes, createCustomPriceRoutes, type RequireRole } from './infra/http/routes';

/** @public A cam's slot as the code proposes it, and where her cams are looked for. */
export type { CamSlot } from './domain/cam';
export type { CamAgenda } from './infra/db/agency-store';
/** @public His orders for the agent's turn: read and written in the turn's own transaction, under her RLS. */
export type { CustomOrderRecord, CustomOrderStore } from './infra/db/order-store';

export interface CustomOrdersModule {
  readonly name: 'custom-orders';
  /** Mounted under `/v1`: `/creators/:creatorId/custom-prices` (the owner's alone) and `…/custom-orders`. */
  readonly routes: FastifyPluginAsyncZod;
  /** Her grid in force for the agent's turn, read as the service role; null when never saved. */
  readonly gridOf: (creatorId: CreatorId) => Promise<CustomPriceGrid | null>;
  /** His open order and what the turn decided about it (ADR 0159 § A), in the turn's transaction. */
  readonly orders: CustomOrderStore;
  /**
   * The slot a call or a video call of `minutes` would take now in her dispos cam (ADR 0159 § 5): soon (« tout de
   * suite ») or later, or null when none has room. Read only: the slot is booked with his full payment.
   */
  readonly camSlot: (creatorId: CreatorId, minutes: number, now: Date) => Promise<CamSlot | null>;
}

export interface CustomOrdersDeps {
  /** Application role: the owner reads and saves her grid under her RLS. */
  readonly db: Database;
  /** Service role: the agent's turn reads her grid, read only, one creator at a time. */
  readonly adminDb: Database;
  /** The owner's gate on the routes. */
  readonly requireRole: RequireRole;
  /** Her dispos cam (`creator-tasks`) and her absence (`creator-limits`), for a cam's slot. */
  readonly camAgenda: CamAgenda;
}

export function createCustomOrdersModule(deps: CustomOrdersDeps): CustomOrdersModule {
  const store = createDrizzleCustomPriceGridStore(deps.db);
  const prices = createCustomPriceRoutes(store, deps.requireRole);
  const orders = createCustomOrderRoutes(
    createDrizzleCustomOrderAgencyStore(deps.db, deps.camAgenda),
    deps.requireRole,
  );
  return {
    name: 'custom-orders',
    routes: async (app, options) => {
      await prices(app, options);
      await orders(app, options);
    },
    gridOf: createCustomPriceGridReader(deps.adminDb),
    orders: createDrizzleCustomOrderStore(),
    camSlot: (creatorId, minutes, now) =>
      camSlotOf(
        {
          room: (ask) => deps.camAgenda.room(creatorId, ask),
          absence: (at) => deps.camAgenda.absence(creatorId, at),
          booked: () => withTenant(deps.db, creatorId, (tx) => bookedCams(tx, creatorId, now)),
        },
        minutes,
        now,
      ),
  };
}
