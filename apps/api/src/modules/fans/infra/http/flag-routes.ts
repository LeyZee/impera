import {
  CreatorIdSchema,
  DomainError,
  FanFlagsViewSchema,
  FanIdSchema,
  FanKycViewSchema,
  FragileDismissalSchema,
  SetFanFlagBodySchema,
  UserIdSchema,
  type CreatorId,
  type FanId,
  type KycSlot,
  type MessageId,
  type UserId,
  type UserRole,
} from '@impera/contracts';
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
 * What the `conversations` module says of a member whose scope is `self` and a fan (by the composition root, ADR 0024,
 * ADR 0025): whether he holds a conversation of this fan, routed to him or taken over by him (how he reads the sheet
 * outside his access window), the trace of his reading the sheet, written as the opening of the fan's conversation,
 * and the words of his own messages a value of his card was read in (ADR 0085 § 5).
 */
export interface FanAccess {
  holds(creatorId: CreatorId, fanId: FanId, userId: UserId): Promise<boolean>;
  traceOpening(
    creatorId: CreatorId,
    fanId: FanId,
    trace: { readonly userId: UserId; readonly ip: string; readonly via: FanSheetVia },
  ): Promise<void>;
  /** The text of those of these messages he sent, by id; a message of someone else, or gone, is left out. */
  messageTexts(
    creatorId: CreatorId,
    fanId: FanId,
    messageIds: readonly MessageId[],
  ): Promise<ReadonlyMap<string, string>>;
}

/** What a chatter opened of a fan's sheet, as the audit log says it: his limits, what is left to learn, his card. */
export type FanSheetVia = 'flags' | 'kyc' | 'card';

/** Without the `conversations` module: nothing is held, only the whole creator reads a fan, nothing to trace. */
export const noFanAccess: FanAccess = {
  holds: () => Promise.resolve(false),
  traceOpening: () => Promise.resolve(),
  messageTexts: () => Promise.resolve(new Map()),
};

/**
 * The signed-in user, allowed to READ this fan's sheet: the whole creator as for a change, a chatter whose access
 * window is open on her (`shiftCreatorIds`, ADR 0025: the sheet of every conversation he treats), or (a chatter, scope
 * `self`) a conversation of this fan he holds: what he cannot write to the fan must be in front of him (EQ-13 « ses
 * Limites du fan (en lecture) », recette 05/11 CHAT-03). A chatter's read is in the audit log before anything is read
 * (ADR 0025). Never a write.
 */
export async function readerFor(
  request: FastifyRequest,
  creatorId: CreatorId,
  fanId: FanId,
  access: FanAccess,
  via: FanSheetVia,
): Promise<UserId> {
  const { user } = request;
  if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  if (user.role === 'owner' || user.creatorIds.includes(creatorId)) return UserIdSchema.parse(user.id);
  if (!user.routedCreatorIds.includes(creatorId)) throw new CreatorForbidden();
  const userId = UserIdSchema.parse(user.id);
  if (!user.shiftCreatorIds.includes(creatorId) && !(await access.holds(creatorId, fanId, userId)))
    throw new CreatorForbidden();
  await access.traceOpening(creatorId, fanId, { userId, ip: request.ip, via });
  return userId;
}

/**
 * `/v1/fans/:id/flags` (P3-02): the owner or a chatter reads a fan's limits, and sets or lifts one; the session's
 * user is the author of the `fan_flag_set` or `fan_flag_cleared` event. A member whose scope is `self` reads them for
 * the fans of a creator his access window opens, or of a conversation he holds, and changes none.
 */
export function createFlagRoutes(
  fans: FansService,
  requireRole: RequireRole,
  now: () => Date = () => new Date(),
  access: FanAccess = noFanAccess,
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
        const actor = await readerFor(request, creatorId, request.params.id, access, 'flags');
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

    // « Écarter » on the AI's proposal to mark him « fragile » (ADR 0085 § 9, lot b2): who may change his limits may
    // set it aside; « Marquer fragile » is the `PUT` above.
    app.post(
      '/fans/:id/fragile/dismiss',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: FanParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: FragileDismissalSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const fanId = request.params.id;
        const actor = actorFor(request, creatorId);
        const at = await fans.dismissFragile(creatorId, fanId, {
          author: `human:${actor}`,
          correlationId: request.id,
        });
        return { fanId, dismissedAt: at.toISOString() };
      },
    );
    return Promise.resolve();
  };
}

/**
 * `GET /v1/fans/:id/kyc` (P5-01): what she has still to learn about him, among the canvas lines `slotsOf` gives (her
 * active persona's, in her order, read at each request), for the line « À apprendre » of the Suivi. Read like his
 * limits, by the owner and the chatters only (a member whose scope is `self`, for a fan routed to him); a fan unknown
 * to this creator is 404 `fan_not_found`.
 */
export function createKycRoutes(
  fans: FansService,
  requireRole: RequireRole,
  slotsOf: (creatorId: CreatorId) => Promise<readonly KycSlot[]>,
  access: FanAccess = noFanAccess,
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
        const fanId = request.params.id;
        await readerFor(request, creatorId, fanId, access, 'kyc');
        if ((await fans.getFan(creatorId, fanId)) === null) throw new FanNotFound();
        return { fanId, toLearn: await fans.kycToLearn(creatorId, fanId, await slotsOf(creatorId)) };
      },
    );
    return Promise.resolve();
  };
}
