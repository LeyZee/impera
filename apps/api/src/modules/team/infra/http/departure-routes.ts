import {
  DepartureParamsSchema,
  DomainError,
  MemberDepartureListSchema,
  MemberDepartureSchema,
  ScheduleDepartureBodySchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { Actor } from '../../domain/ports';
import type { DepartureStore } from '../departure-store';

import type { RequireRole } from './routes';

const MemberParamsSchema = z.object({ memberId: TeamMemberIdSchema });

function actorOf(request: FastifyRequest): Actor {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return { userId: UserIdSchema.parse(request.user.id), ip: request.ip };
}

/**
 * A member's departure (ADR 0166) under `/v1/team`, the owner's alone with a recent sign-in for every write:
 * `GET /team/departures` lists those waiting and those whose Reveal access is not ticked; `POST
 * /team/members/:memberId/departure` sets one (now, or later within 31 days); `POST /team/departures/:departureId/cancel`
 * cancels one before its hour; `POST /team/departures/:departureId/reveal-removed` ticks « Accès Reveal retiré ».
 */
export function createDepartureRoutes(
  store: DepartureStore,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  const owner = requireRole('owner');
  const ownerConfirmed = [owner, recentLogin];
  return (app) => {
    app.get(
      '/team/departures',
      { preValidation: owner, schema: { response: { 200: MemberDepartureListSchema } } },
      async (request) => ({ departures: await store.list(actorOf(request)) }),
    );

    app.post(
      '/team/members/:memberId/departure',
      {
        preValidation: ownerConfirmed,
        schema: {
          params: MemberParamsSchema,
          body: ScheduleDepartureBodySchema,
          response: { 201: MemberDepartureSchema },
        },
      },
      async (request, reply) => {
        const { endsAt, reason } = request.body;
        const departure = await store.schedule(
          actorOf(request),
          request.params.memberId,
          endsAt === null ? null : new Date(endsAt),
          reason,
        );
        return reply.code(201).send(departure);
      },
    );

    app.post(
      '/team/departures/:departureId/cancel',
      {
        preValidation: ownerConfirmed,
        schema: { params: DepartureParamsSchema, response: { 200: MemberDepartureSchema } },
      },
      (request) => store.cancel(actorOf(request), request.params.departureId),
    );

    app.post(
      '/team/departures/:departureId/reveal-removed',
      {
        preValidation: ownerConfirmed,
        schema: { params: DepartureParamsSchema, response: { 200: MemberDepartureSchema } },
      },
      (request) => store.revealRemoved(actorOf(request), request.params.departureId),
    );
    return Promise.resolve();
  };
}
