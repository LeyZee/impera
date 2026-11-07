import {
  ActivatePersonaVersionBodySchema,
  ActivatePersonaVersionParamsSchema,
  CreatePersonaVersionBodySchema,
  CreatorIdSchema,
  DomainError,
  MyPersonaSchema,
  PersonaCorrectionListSchema,
  PersonaCorrectionParamsSchema,
  PersonaCorrectionSchema,
  PersonaOverviewSchema,
  PersonaVersionSummarySchema,
  ProposePersonaCorrectionBodySchema,
  type CreatorId,
  type CurrentUser,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { PersonaCorrectionStore } from '../../domain/corrections';
import { answersOf, sheetOf } from '../../domain/sheet';
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
  corrections: PersonaCorrectionStore,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/:creatorId/persona',
      {
        // The agency's sheet, its strategies and its history: never the creator's (recette CREA-01), who reads hers
        // at `…/persona/mine`.
        preValidation: requireRole('owner', 'operator'),
        schema: { params: CreatorParamsSchema, response: { 200: PersonaOverviewSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        actorFor(request, creatorId);
        return store.overview(creatorId);
      },
    );

    app.get(
      '/creators/:creatorId/persona/mine',
      {
        preValidation: requireRole('creator'),
        schema: { params: CreatorParamsSchema, response: { 200: MyPersonaSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        actorFor(request, creatorId);
        const active = await store.active(creatorId);
        if (active === null) return { creatorId, sheet: null, answers: null };
        return { creatorId, sheet: sheetOf(active.persona), answers: answersOf(active.persona) };
      },
    );

    app.post(
      '/creators/:creatorId/persona/versions',
      {
        // Only the owner changes it: the creator reads her sheet and proposes, the agency writes (recette CREA-01,
        // Charles 05/11).
        preValidation: requireRole('owner'),
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
        // The one in force: the owner, who alone changes her persona, chooses it. It changes what the agent
        // says of her to every fan, so a sign-in of less than 10 minutes is asked, as for her hours (audit de
        // sécurité du 02/11, M1): a stolen session or a laptop left open is not enough.
        preValidation: [requireRole('owner'), recentLogin],
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

    app.get(
      '/creators/:creatorId/persona/corrections',
      {
        // Hers to her; to the owner and an active manager, on her persona (a chatter, closed by her policies or by his list, reads none).
        preValidation: requireRole('owner', 'operator', 'creator'),
        schema: { params: CreatorParamsSchema, response: { 200: PersonaCorrectionListSchema } },
      },
      async (request) => {
        const { creatorId } = request.params;
        const user = actorFor(request, creatorId);
        const list =
          user.role === 'creator'
            ? await corrections.mine(user.id)
            : await corrections.list(creatorId, user.id);
        return { corrections: [...list] };
      },
    );

    app.post(
      '/creators/:creatorId/persona/corrections',
      {
        // She reads her sheet and proposes, the agency changes it (recette CREA-01 b, Charles 05/11 « go recos »).
        preValidation: requireRole('creator'),
        schema: {
          params: CreatorParamsSchema,
          body: ProposePersonaCorrectionBodySchema,
          response: { 201: PersonaCorrectionSchema },
        },
      },
      async (request, reply) => {
        const user = actorFor(request, request.params.creatorId);
        return reply.code(201).send(await corrections.propose(user.id, request.body));
      },
    );

    app.post(
      '/creators/:creatorId/persona/corrections/:correctionId/done',
      {
        // The owner, who alone changes her persona, says he handled it.
        preValidation: requireRole('owner'),
        schema: { params: PersonaCorrectionParamsSchema, response: { 200: PersonaCorrectionSchema } },
      },
      async (request) => {
        const { creatorId, correctionId } = request.params;
        const user = actorFor(request, creatorId);
        return corrections.markDone(creatorId, correctionId, user.id);
      },
    );
    return Promise.resolve();
  };
}
