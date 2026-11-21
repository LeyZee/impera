import {
  CreatorIdSchema,
  CustomPriceGridViewSchema,
  DomainError,
  SaveCustomPriceGridBodySchema,
  UserIdSchema,
  type CustomPriceErrorCode,
  type UserRole,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { CustomPriceActor, CustomPriceGridStore } from '../../domain/ports';

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
