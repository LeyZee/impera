import {
  AnswerToAgencyMessageBodySchema,
  ToAgencyMessageParamsSchema,
  ToAgencyMessageSchema,
  ToAgencyMessagesSchema,
  DomainError,
  NewToAgencyMessageBodySchema,
  WaitingToAgencyMessagesSchema,
  type CreatorId,
  type UserRole,
  type WaitingToAgencyMessage,
} from '@impera/contracts';
import { NotACreatorAccount } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { CreatorAccountForbidden, MessagesForbidden } from '../../domain/errors';
import type { MessageStore } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

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

export interface MessageRoutesDeps {
  readonly store: MessageStore;
  readonly requireRole: RequireRole;
  /** Every creator not archived: the agency's list is read one creator at a time, each under her own RLS. */
  readonly allCreatorIds: () => Promise<readonly CreatorId[]>;
  readonly clock?: () => Date;
}

/** Her writing to the agency: twenty an hour is far beyond a person, and a replay counts too. */
const WRITE_LIMIT = { max: 20, timeWindow: '1 hour', skipOnError: false };

/**
 * « Écrire à l'agence » (trous béants n° 13): hers under `/v1/creator-space/messages`; the agency's waiting list under
 * `/v1/creator-messages/waiting` (owner, an active manager); the owner's answer under
 * `/v1/creators/:creatorId/messages/:id/answer`.
 */
export function createMessageRoutes(deps: MessageRoutesDeps): FastifyPluginAsyncZod {
  const clock = deps.clock ?? (() => new Date());
  return (app) => {
    const creatorOnly = { preValidation: deps.requireRole('creator') };

    app.get(
      '/creator-space/messages',
      { ...creatorOnly, schema: { response: { 200: ToAgencyMessagesSchema } } },
      (request) => asCreator(() => deps.store.mine(signedIn(request.user))),
    );

    app.post(
      '/creator-space/messages',
      {
        ...creatorOnly,
        // A few messages an hour: a stolen session never floods the agency (avis Sécurité, 21/11).
        config: { rateLimit: WRITE_LIMIT },
        schema: { body: NewToAgencyMessageBodySchema, response: { 201: ToAgencyMessageSchema } },
      },
      async (request, reply) => {
        const message = await asCreator(() => deps.store.write(signedIn(request.user), request.body));
        return reply.code(201).send(message);
      },
    );

    app.get(
      '/creator-messages/waiting',
      {
        preValidation: deps.requireRole('owner', 'operator'),
        schema: { response: { 200: WaitingToAgencyMessagesSchema } },
      },
      async (request) => {
        const userId = signedIn(request.user);
        // One tenant transaction per creator (RLS), one after the other: a chatter is refused at the first.
        const waiting: WaitingToAgencyMessage[] = [];
        let readable = false;
        for (const creatorId of await deps.allCreatorIds()) {
          try {
            waiting.push(...(await deps.store.waiting(creatorId, userId)));
            readable = true;
          } catch (error) {
            if (!(error instanceof MessagesForbidden)) throw error;
          }
        }
        if (!readable && waiting.length === 0 && request.user?.role !== 'owner') {
          throw new MessagesForbidden('read');
        }
        return { messages: waiting.sort((a, b) => a.createdAt.localeCompare(b.createdAt)) };
      },
    );

    app.post(
      '/creators/:creatorId/messages/:id/answer',
      {
        preValidation: deps.requireRole('owner'),
        schema: {
          params: ToAgencyMessageParamsSchema,
          body: AnswerToAgencyMessageBodySchema,
          response: { 200: ToAgencyMessageSchema },
        },
      },
      (request) =>
        deps.store.answer(
          request.params.creatorId,
          signedIn(request.user),
          request.params.id,
          request.body.answer,
          clock(),
        ),
    );

    return Promise.resolve();
  };
}
