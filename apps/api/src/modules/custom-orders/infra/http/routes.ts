import {
  AdvanceCustomOrderBodySchema,
  CreatorIdSchema,
  CustomOrderIdSchema,
  CustomOrderListQuerySchema,
  CustomOrderListSchema,
  CustomOrderViewSchema,
  DecideCustomOrderBodySchema,
  CustomPriceGridViewSchema,
  DomainError,
  SaveCustomPriceGridBodySchema,
  UserIdSchema,
  type CustomOrderErrorCode,
  type CustomPriceErrorCode,
  type UserRole,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CustomPriceActor, CustomPriceGridStore } from '../../domain/ports';
import type { CustomOrderAgencyStore, CustomOrderMove } from '../db/agency-store';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

class CustomPricesCreatorNotFound extends DomainError {
  constructor() {
    super('custom_prices_creator_not_found' satisfies CustomPriceErrorCode, 'Créatrice introuvable');
  }
}

class CustomPricesVersionConflict extends DomainError {
  constructor(current: number) {
    super(
      'custom_prices_version_conflict' satisfies CustomPriceErrorCode,
      'La grille a été enregistrée ailleurs entre-temps : recharge-la avant de la changer',
      { details: { current } },
    );
  }
}

class CustomOrderNotFound extends DomainError {
  constructor() {
    super('custom_order_not_found' satisfies CustomOrderErrorCode, 'Commande introuvable');
  }
}

class CustomOrderMoveConflict extends DomainError {
  constructor(state: string) {
    super(
      'custom_order_move_conflict' satisfies CustomOrderErrorCode,
      'Cette commande a déjà changé d’état : recharge la liste',
      { details: { state } },
    );
  }
}

/** The order after a move, or the refusal said plainly. */
function movedOrThrow(result: CustomOrderMove | null) {
  if (result === null || result.kind === 'not_found') throw new CustomOrderNotFound();
  if (result.kind === 'refused') throw new CustomOrderMoveConflict(result.state);
  return result.order;
}

function actorOf(request: FastifyRequest): CustomPriceActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

const CreatorParams = z.object({ creatorId: CreatorIdSchema });

/**
 * `/v1/creators/:creatorId/custom-prices` (ADR 0159 § C), the owner's alone: `GET` her grid in force, `PUT` a new
 * version of it on the one the screen read.
 */
export function createCustomPriceRoutes(
  store: CustomPriceGridStore,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    const owner = { preValidation: requireRole('owner') };

    app.get(
      '/creators/:creatorId/custom-prices',
      { ...owner, schema: { params: CreatorParams, response: { 200: CustomPriceGridViewSchema } } },
      async (request) => {
        const view = await store.read(request.params.creatorId, actorOf(request));
        if (view === null) throw new CustomPricesCreatorNotFound();
        return view;
      },
    );

    app.put(
      '/creators/:creatorId/custom-prices',
      {
        ...owner,
        schema: {
          params: CreatorParams,
          body: SaveCustomPriceGridBodySchema,
          response: { 200: CustomPriceGridViewSchema },
        },
      },
      async (request) => {
        const saved = await store.save(
          request.params.creatorId,
          request.body.baseVersion,
          request.body.grid,
          actorOf(request),
        );
        if (saved === null) throw new CustomPricesCreatorNotFound();
        if (saved.kind === 'conflict') throw new CustomPricesVersionConflict(saved.current);
        return saved.view;
      },
    );
    return Promise.resolve();
  };
}

const OrderParams = z.object({ creatorId: CreatorIdSchema, orderId: CustomOrderIdSchema });

/**
 * `/v1/creators/:creatorId/custom-orders` (ADR 0159 § A.3): `GET` her orders (the owner, or an active manager who
 * follows her), `POST …/:orderId/decision` her answer (yes at a price, or no) and `POST …/:orderId/advance` the next
 * step (deposit received, delivered, cancelled), the owner's alone. A refusal reads the same for an order of another
 * creator and for none.
 */
export function createCustomOrderRoutes(
  store: CustomOrderAgencyStore,
  requireRole: RequireRole,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/custom-orders',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: CreatorParams,
          querystring: CustomOrderListQuerySchema,
          response: { 200: CustomOrderListSchema },
        },
      },
      async (request) => {
        const orders = await store.list(request.params.creatorId, request.query.scope, actorOf(request));
        if (orders === null) throw new CustomPricesCreatorNotFound();
        return { orders };
      },
    );

    app.post(
      '/creators/:creatorId/custom-orders/:orderId/decision',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: OrderParams,
          body: DecideCustomOrderBodySchema,
          response: { 200: CustomOrderViewSchema },
        },
      },
      async (request) =>
        movedOrThrow(
          await store.decide(
            request.params.creatorId,
            request.params.orderId,
            request.body,
            actorOf(request),
          ),
        ),
    );

    app.post(
      '/creators/:creatorId/custom-orders/:orderId/advance',
      {
        preValidation: requireRole('owner'),
        schema: {
          params: OrderParams,
          body: AdvanceCustomOrderBodySchema,
          response: { 200: CustomOrderViewSchema },
        },
      },
      async (request) =>
        movedOrThrow(
          await store.advance(
            request.params.creatorId,
            request.params.orderId,
            request.body,
            actorOf(request),
          ),
        ),
    );
    return Promise.resolve();
  };
}
