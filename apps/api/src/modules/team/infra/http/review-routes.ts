import {
  ContestRemarkBodySchema,
  DomainError,
  MyShiftReviewSchema,
  RemarkParamsSchema,
  ReviewShiftParamsSchema,
  ReviewShiftQuerySchema,
  RuleRemarkBodySchema,
  UserIdSchema,
  type UserId,
} from '@impera/contracts';
import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ReviewService } from '../../application/review';
import type { Actor } from '../../domain/ports';

import type { RequireRole } from './routes';

function userOf(request: FastifyRequest): UserId {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return UserIdSchema.parse(request.user.id);
}

const actorOf = (request: FastifyRequest): Actor => ({ userId: userOf(request), ip: request.ip });
const SeenBodySchema = z.object({ creatorId: ReviewShiftQuerySchema.shape.creatorId });

/**
 * `/v1/team/review` (ADR 0170 §§ 12 to 14, 26 to 30): « Mon bilan » of a shift, read by the member himself; his
 * « vu », his contest; the ruling of the owner or a manager. Who reads and writes what is the policies' call
 * (`withTenantMember`, migration 0281) and the service's.
 */
export function createReviewRoutes(reviews: ReviewService, requireRole: RequireRole): FastifyPluginAsyncZod {
  const member = requireRole('operator');
  const ownerOrMember = requireRole('owner', 'operator');
  return (app) => {
    app.get(
      '/team/review/shifts/:shiftId',
      {
        preValidation: member,
        schema: {
          params: ReviewShiftParamsSchema,
          querystring: ReviewShiftQuerySchema,
          response: { 200: MyShiftReviewSchema },
        },
      },
      async (request) =>
        reviews.myShiftReview(userOf(request), request.query.creatorId, request.params.shiftId),
    );

    app.post(
      '/team/review/shifts/:shiftId/seen',
      { preValidation: member, schema: { params: ReviewShiftParamsSchema, body: SeenBodySchema } },
      async (request, reply) => {
        await reviews.markSeen(userOf(request), request.body.creatorId, request.params.shiftId);
        return reply.code(204).send();
      },
    );

    app.post(
      '/team/review/remarks/:remarkId/contest',
      { preValidation: member, schema: { params: RemarkParamsSchema, body: ContestRemarkBodySchema } },
      async (request, reply) => {
        await reviews.contest(actorOf(request), request.params.remarkId, request.body);
        return reply.code(204).send();
      },
    );

    app.post(
      '/team/review/remarks/:remarkId/ruling',
      { preValidation: ownerOrMember, schema: { params: RemarkParamsSchema, body: RuleRemarkBodySchema } },
      async (request, reply) => {
        await reviews.rule(actorOf(request), request.params.remarkId, request.body);
        return reply.code(204).send();
      },
    );
    return Promise.resolve();
  };
}
