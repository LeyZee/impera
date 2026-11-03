import {
  ContentDropIdSchema,
  ContentDropSchema,
  ContentRequestIdSchema,
  ContentRequestSchema,
  CorrectDropCategoryBodySchema,
  CreateContentDropBodySchema,
  CreateContentRequestBodySchema,
  CreatorContentSchema,
  CreatorIdSchema,
  DomainError,
  RefuseContentRequestBodySchema,
  type UserRole,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { AgencyContentStore, CreatorContentStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/** A `creator` session whose account is not linked to exactly one creator (the base forbids it): refused. */
class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

function signedIn(user: { readonly id: string } | null): string {
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return user.id;
}

async function asCreator<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
    throw error;
  }
}

const DropParamsSchema = z.object({ id: ContentDropIdSchema });
const RequestParamsSchema = z.object({ id: ContentRequestIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });
const CreatorDropParamsSchema = z.object({ creatorId: CreatorIdSchema, id: ContentDropIdSchema });
const CreatorRequestParamsSchema = z.object({ creatorId: CreatorIdSchema, id: ContentRequestIdSchema });

/**
 * Her content under `/v1/creator-space` (creator, CR-06), and the agency's under `/v1/creators/:creatorId` (owner,
 * operator: the store refuses a chatter). Her creator is read in her account, never in the request. `now` is the
 * server's clock.
 */
export function createContentDropRoutes(
  creator: CreatorContentStore,
  agency: AgencyContentStore,
  requireRole: RequireRole,
  clock: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };
    const team = { preValidation: requireRole('owner', 'operator') };

    app.get(
      '/creator-space/content',
      { ...creatorOnly, schema: { response: { 200: CreatorContentSchema } } },
      (request) => asCreator(() => creator.content(signedIn(request.user))),
    );

    app.post(
      '/creator-space/drops',
      { ...creatorOnly, schema: { body: CreateContentDropBodySchema, response: { 200: ContentDropSchema } } },
      (request) => asCreator(() => creator.drop(signedIn(request.user), request.body)),
    );

    app.delete(
      '/creator-space/drops/:id',
      { ...creatorOnly, schema: { params: DropParamsSchema } },
      async (request, reply) => {
        await asCreator(() => creator.withdraw(signedIn(request.user), request.params.id, clock()));
        return reply.code(204).send();
      },
    );

    app.post(
      '/creator-space/content-requests/:id/refuse',
      { ...creatorOnly, schema: { params: RequestParamsSchema, body: RefuseContentRequestBodySchema } },
      async (request, reply) => {
        await asCreator(() =>
          creator.refuse(signedIn(request.user), request.params.id, request.body.reason, clock()),
        );
        return reply.code(204).send();
      },
    );

    app.get(
      '/creators/:creatorId/content',
      { ...team, schema: { params: CreatorParamsSchema, response: { 200: CreatorContentSchema } } },
      (request) => agency.content(request.params.creatorId, signedIn(request.user)),
    );

    app.post(
      '/creators/:creatorId/drops',
      {
        ...team,
        schema: {
          params: CreatorParamsSchema,
          body: CreateContentDropBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      (request) => agency.drop(request.params.creatorId, signedIn(request.user), request.body),
    );

    app.patch(
      '/creators/:creatorId/drops/:id',
      {
        ...team,
        schema: {
          params: CreatorDropParamsSchema,
          body: CorrectDropCategoryBodySchema,
          response: { 200: ContentDropSchema },
        },
      },
      (request) =>
        agency.correct(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.category,
          clock(),
        ),
    );

    app.delete(
      '/creators/:creatorId/drops/:id',
      { ...team, schema: { params: CreatorDropParamsSchema } },
      async (request, reply) => {
        await agency.withdraw(request.params.creatorId, signedIn(request.user), request.params.id, clock());
        return reply.code(204).send();
      },
    );

    app.post(
      '/creators/:creatorId/content-requests',
      {
        ...team,
        schema: {
          params: CreatorParamsSchema,
          body: CreateContentRequestBodySchema,
          response: { 200: ContentRequestSchema },
        },
      },
      (request) => agency.ask(request.params.creatorId, signedIn(request.user), request.body),
    );

    app.delete(
      '/creators/:creatorId/content-requests/:id',
      { ...team, schema: { params: CreatorRequestParamsSchema } },
      async (request, reply) => {
        await agency.cancel(request.params.creatorId, signedIn(request.user), request.params.id, clock());
        return reply.code(204).send();
      },
    );

    return Promise.resolve();
  };
}
