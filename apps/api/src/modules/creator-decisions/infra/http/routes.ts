import {
  AgencyDecisionParamsSchema,
  AgencyDecisionsParamsSchema,
  AnswerDecisionBodySchema,
  AnsweredDecisionSchema,
  CreatorDecisionParamsSchema,
  CreatorDecisionsSchema,
  DomainError,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { DecisionActor, DecisionStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

export interface DecisionRoutesDeps {
  readonly store: DecisionStore;
  readonly requireRole: RequireRole;
  readonly clock?: () => Date;
}

/** A `creator` session whose account is not linked to exactly one creator (the base forbids it): refused. */
class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

function actorOf(request: FastifyRequest): DecisionActor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: request.user.id, ip: request.ip };
}

async function asCreator<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
    throw error;
  }
}

/**
 * « À décider », hers (ADR 0162): she reads what waits on her under `/v1/creator-space/decisions`, answers it or puts
 * it aside; the owner reads and answers in her place under `/v1/creators/:creatorId/decisions`. The store reads each
 * person's right again in the base. `now` is the server's clock.
 */
export function createDecisionRoutes(deps: DecisionRoutesDeps): FastifyPluginAsyncZod {
  const clock = deps.clock ?? (() => new Date());
  return (app) => {
    const creatorOnly = { preValidation: deps.requireRole('creator') };
    const ownerOnly = { preValidation: deps.requireRole('owner') };

    app.get(
      '/creator-space/decisions',
      { ...creatorOnly, schema: { response: { 200: CreatorDecisionsSchema } } },
      async (request) => ({
        decisions: await asCreator(() => deps.store.open(actorOf(request).userId, clock())),
      }),
    );

    app.post(
      '/creator-space/decisions/:id/answer',
      {
        ...creatorOnly,
        schema: {
          params: CreatorDecisionParamsSchema,
          body: AnswerDecisionBodySchema,
          response: { 200: AnsweredDecisionSchema },
        },
      },
      async (request) => ({
        noted: await asCreator(() =>
          deps.store.answer(actorOf(request).userId, request.params.id, request.body.answer, clock()),
        ),
      }),
    );

    app.post(
      '/creator-space/decisions/:id/later',
      { ...creatorOnly, schema: { params: CreatorDecisionParamsSchema } },
      async (request, reply) => {
        await asCreator(() => deps.store.later(actorOf(request).userId, request.params.id, clock()));
        return reply.code(204).send();
      },
    );

    app.get(
      '/creators/:creatorId/decisions',
      {
        ...ownerOnly,
        schema: { params: AgencyDecisionsParamsSchema, response: { 200: CreatorDecisionsSchema } },
      },
      async (request) => ({
        decisions: await deps.store.openFor(actorOf(request), request.params.creatorId, clock()),
      }),
    );

    app.post(
      '/creators/:creatorId/decisions/:id/answer',
      {
        ...ownerOnly,
        schema: {
          params: AgencyDecisionParamsSchema,
          body: AnswerDecisionBodySchema,
          response: { 200: AnsweredDecisionSchema },
        },
      },
      async (request) => ({
        noted: await deps.store.answerFor(
          actorOf(request),
          request.params.creatorId,
          request.params.id,
          request.body.answer,
          clock(),
        ),
      }),
    );

    return Promise.resolve();
  };
}
