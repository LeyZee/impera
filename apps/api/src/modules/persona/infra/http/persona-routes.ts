import {
  ActivatePersonaVersionBodySchema,
  ActivatePersonaVersionParamsSchema,
  CreatePersonaVersionBodySchema,
  CreatorIdSchema,
  DomainError,
  PersonaOverviewSchema,
  PersonaVersionSummarySchema,
  type CreatorId,
  type CurrentUser,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { PersonaVersionStore } from '../../domain/versions';

import type { RequireRole } from './routes';

class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

/** The signed-in user, allowed on this creator: an owner sees every creator, anyone else their own list. */
function actorFor(request: FastifyRequest, creatorId: CreatorId): CurrentUser {
  const { user } = request;
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  if (user.role !== 'owner' && !user.creatorIds.includes(creatorId)) throw new CreatorForbidden();
  return user;
}

/**
 * `/v1/creators/:creatorId/persona` (ADR 0010): the dashboard reads her versions, stores a new one (never active),
 * and activates one, an audited event.
 */
export function createPersonaRoutes(
  store: PersonaVersionStore,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/persona',
      {
        preValidation: requireRole('owner', 'operator', 'creator'),
        schema: { params: CreatorParamsSchema, response: { 200: PersonaOverviewSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        actorFor(request, creatorId);
        return store.overview(creatorId);
      },
    );

    app.post(
      '/creators/:creatorId/persona/versions',
      {
        // Chatters read her persona; only the owner and the creator herself change it.
        preValidation: requireRole('owner', 'creator'),
        schema: {
          params: CreatorParamsSchema,
          body: CreatePersonaVersionBodySchema,
          response: { 201: PersonaVersionSummarySchema },
        },
      },
      async (request, reply) => {
        const { creatorId } = request.params;
        const user = actorFor(request, creatorId);
        const created = await store.create(creatorId, request.body, user.id);
        return reply.code(201).send(created);
      },
    );

    app.post(
      '/creators/:creatorId/persona/versions/:versionId/activate',
      {
        // The one the agent writes with: the same people who change her persona choose it. It changes what the agent
        // says of her to every fan, so a sign-in of less than 10 minutes is asked, as for her hours (audit de
        // sécurité du 02/11, M1): a stolen session or a laptop left open is not enough.
        preValidation: [requireRole('owner', 'creator'), recentLogin],
        schema: {
          params: ActivatePersonaVersionParamsSchema,
          body: ActivatePersonaVersionBodySchema,
          response: { 200: PersonaVersionSummarySchema },
        },
      },
      async (request) => {
        const { creatorId, versionId } = request.params;
        const user = actorFor(request, creatorId);
        return store.activate(creatorId, versionId, request.body.expectedActive, user.id);
      },
    );
    return Promise.resolve();
  };
}
