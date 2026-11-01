import {
  CreatorIdSchema,
  DomainError,
  FanFlagsViewSchema,
  FanIdSchema,
  FanKycViewSchema,
  SetFanFlagBodySchema,
  UserIdSchema,
  type CreatorId,
  type KycSlot,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { FansService } from '../../application/fans';
import { FanNotFound } from '../../domain/errors';
import { requestedChange, type FlagAuthor } from '../../domain/flags';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

const FanParamsSchema = z.object({ id: FanIdSchema });
const CreatorQuerySchema = z.object({ creatorId: CreatorIdSchema });

/** The signed-in user, allowed on this creator: an owner sees every creator, anyone else their own list. */
function actorFor(request: FastifyRequest, creatorId: CreatorId): UserId {
  const { user } = request;
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  if (user.role !== 'owner' && !user.creatorIds.includes(creatorId)) throw new CreatorForbidden();
  return UserIdSchema.parse(user.id);
}

/**
 * `/v1/fans/:id/flags` (P3-02): the owner or a chatter reads a fan's limits, and sets or lifts one; the session's
 * user is the author of the `fan_flag_set` or `fan_flag_cleared` event.
 */
export function createFlagRoutes(
  fans: FansService,
  requireRole: RequireRole,
  now: () => Date = () => new Date(),
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/fans/:id/flags',
      {
        // A creator never sees her fans' data (ADR 0023): the owner and the chatters only.
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: FanParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: FanFlagsViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const actor = actorFor(request, creatorId);
        return { fanId: request.params.id, ...(await fans.flagsFor(creatorId, request.params.id, actor)) };
      },
    );

    app.put(
      '/fans/:id/flags',
      {
        // His limits are a chatter's call, like the drafts: the creator reads them.
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: FanParamsSchema,
          querystring: CreatorQuerySchema,
          body: SetFanFlagBodySchema,
          response: { 200: FanFlagsViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const fanId = request.params.id;
        const { body } = request;
        const actor = actorFor(request, creatorId);
        const author: FlagAuthor = `human:${actor}`;
        const command = {
          author,
          correlationId: request.id,
          ...(body.reason !== undefined && { reason: body.reason }),
        };
        // His limits and the author's right, both from the transaction that wrote them.
        const written = body.set
          ? await fans.setFlag(creatorId, fanId, requestedChange(body, now()), command)
          : await fans.clearFlag(creatorId, fanId, body.flag, command);
        return { fanId, ...written };
      },
    );
    return Promise.resolve();
  };
}

/**
 * `GET /v1/fans/:id/kyc` (P5-01): what she has still to learn about him, among the canvas lines `slotsOf` gives (her
 * active persona's, in her order, read at each request), for the line « À apprendre » of the Suivi. Read like his
 * limits, by the owner and the chatters only; a fan unknown to this creator is 404 `fan_not_found`.
 */
export function createKycRoutes(
  fans: FansService,
  requireRole: RequireRole,
  slotsOf: (creatorId: CreatorId) => Promise<readonly KycSlot[]>,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/fans/:id/kyc',
      {
        // A creator never sees her fans' data (ADR 0023).
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: FanParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: FanKycViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        actorFor(request, creatorId);
        const fanId = request.params.id;
        if ((await fans.getFan(creatorId, fanId)) === null) throw new FanNotFound();
        return { fanId, toLearn: await fans.kycToLearn(creatorId, fanId, await slotsOf(creatorId)) };
      },
    );
    return Promise.resolve();
  };
}
