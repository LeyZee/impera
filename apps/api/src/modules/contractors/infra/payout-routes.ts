import {
  DomainError,
  PayoutDestinationListSchema,
  PayoutDestinationParamsSchema,
  PayoutDestinationSchema,
  PutPayoutDetailsBodySchema,
  UserIdSchema,
} from '@impera/contracts';
import type { FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { Actor } from '../domain/ports';

import type { PayoutDestinationStore } from './payout-store';
import type { RequireRole } from './routes';

function actorOf(request: FastifyRequest): Actor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

/** Where a member is paid is never kept by a browser nor a proxy (ADR 0165 § 4). */
const noStore = (reply: FastifyReply): FastifyReply => reply.header('cache-control', 'private, no-store');

/**
 * « Où te verser » (ADR 0165) under `/v1/payroll`: `GET /payroll/payout-destinations` lists to the owner the way each
 * member receives and his last change, never a number; `GET …/contractors/:memberId/payout-destination` gives a member
 * his own; `POST …/payout-destination/reveal` shows the owner one member's, with a recent sign-in, journalised; `PUT`
 * writes the member's own, with a recent sign-in. A manager is refused everywhere, by the store and by the base.
 */
export function createPayoutDestinationRoutes(
  store: PayoutDestinationStore,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  const owner = requireRole('owner');
  const ownerOrMember = requireRole('owner', 'operator');
  return (app) => {
    app.get(
      '/payroll/payout-destinations',
      { preValidation: owner, schema: { response: { 200: PayoutDestinationListSchema } } },
      async (request, reply) => noStore(reply).send(await store.list(actorOf(request))),
    );

    app.get(
      '/payroll/contractors/:memberId/payout-destination',
      {
        preValidation: ownerOrMember,
        schema: { params: PayoutDestinationParamsSchema, response: { 200: PayoutDestinationSchema } },
      },
      async (request, reply) =>
        noStore(reply).send(await store.readOwn(actorOf(request), request.params.memberId)),
    );

    app.post(
      '/payroll/contractors/:memberId/payout-destination/reveal',
      {
        preValidation: [owner, recentLogin],
        schema: { params: PayoutDestinationParamsSchema, response: { 200: PayoutDestinationSchema } },
      },
      async (request, reply) =>
        noStore(reply).send(await store.reveal(actorOf(request), request.params.memberId)),
    );

    app.put(
      '/payroll/contractors/:memberId/payout-destination',
      {
        preValidation: [ownerOrMember, recentLogin],
        schema: {
          params: PayoutDestinationParamsSchema,
          body: PutPayoutDetailsBodySchema,
          response: { 200: PayoutDestinationSchema, 201: PayoutDestinationSchema },
        },
      },
      async (request, reply) => {
        const { destination, created } = await store.write(
          actorOf(request),
          request.params.memberId,
          request.body,
        );
        return noStore(reply)
          .code(created ? 201 : 200)
          .send(destination);
      },
    );
    return Promise.resolve();
  };
}
