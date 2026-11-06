import {
  ConversationIdSchema,
  CreatorConversationSchema,
  CreatorFanInsightsSchema,
  CreatorFanPageSchema,
  CreatorFansQuerySchema,
  CreatorMessagePageSchema,
  CreatorMessagesQuerySchema,
  DomainError,
  UserIdSchema,
  type UserId,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { ConversationNotFound } from '../../domain/errors';
import type { CreatorSpaceReader } from '../../domain/ports';

import type { RequireRole } from './routes';

/** A `creator` session whose account is not linked to exactly one creator (the base forbids it): refused. */
class CreatorAccountForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Ce compte n’est lié à aucune créatrice');
  }
}

const ConversationParamsSchema = z.object({ id: ConversationIdSchema });

function creatorOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

async function asCreator<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof NotACreatorAccount) throw new CreatorAccountForbidden();
    throw error;
  }
}

/**
 * `/v1/creator-space` (CR-02, ADR 0042 § 2): what the creator reads of her own account, read only. Her creator is read
 * in her account by the server, never in the request; there is no route that writes to a fan. The response schemas are
 * `strict`: a message never carries its author.
 */
export function createCreatorSpaceRoutes(
  reader: CreatorSpaceReader,
  requireRole: RequireRole,
  clock: { now(): Date },
): FastifyPluginAsyncZod {
  return (app) => {
    const creatorOnly = { preValidation: requireRole('creator') };

    app.get(
      '/creator-space/fans',
      {
        ...creatorOnly,
        schema: { querystring: CreatorFansQuerySchema, response: { 200: CreatorFanPageSchema } },
      },
      (request) => asCreator(() => reader.fans(creatorOf(request), request.query)),
    );

    // « Qui sont tes fans » (CR-15, ADR 0074): shares on all her fans, never a value a fan wrote nor a case's count.
    app.get(
      '/creator-space/fan-insights',
      { ...creatorOnly, schema: { response: { 200: CreatorFanInsightsSchema } } },
      (request) => asCreator(() => reader.fanInsights(creatorOf(request), clock.now())),
    );

    app.get(
      '/creator-space/conversations/:id',
      {
        ...creatorOnly,
        schema: { params: ConversationParamsSchema, response: { 200: CreatorConversationSchema } },
      },
      async (request) => {
        const opened = await asCreator(() =>
          reader.openConversation(creatorOf(request), request.params.id, request.ip),
        );
        if (opened === null) throw new ConversationNotFound();
        return opened;
      },
    );

    app.get(
      '/creator-space/conversations/:id/messages',
      {
        ...creatorOnly,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorMessagesQuerySchema,
          response: { 200: CreatorMessagePageSchema },
        },
      },
      async (request) => {
        const page = await asCreator(() =>
          reader.messages(creatorOf(request), request.params.id, request.query, request.ip),
        );
        if (page === null) throw new ConversationNotFound();
        return page;
      },
    );
    return Promise.resolve();
  };
}
