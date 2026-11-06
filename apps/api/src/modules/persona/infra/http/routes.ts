import {
  AgentHoursViewSchema,
  ArchivedCreatorListSchema,
  ArchivedCreatorSchema,
  CreatorIdSchema,
  CreatorListSchema,
  CreatorSummarySchema,
  DomainError,
  NewCreatorSchema,
  SetAgentHoursBodySchema,
  UpdateCreatorBodySchema,
  type CreatorErrorCode,
  type CreatorId,
  type CreatorPlanned,
  type UserRole,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { CreatorPlannedConflict } from '../../domain/errors';
import type { CreatorDirectory } from '../../domain/ports';

const CreatorParamsSchema = z.object({ id: CreatorIdSchema });
const CreatorIdParamsSchema = z.object({ creatorId: CreatorIdSchema });

class CreatorNotFound extends DomainError {
  constructor() {
    super('creator_not_found' satisfies CreatorErrorCode, 'Créatrice introuvable');
  }
}

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

/**
 * `GET /v1/creators`: the creators the signed-in user may open, an owner sees them all, a team member whose scope is
 * `self` (a chatter) the creators where conversations are routed to him (`routedCreatorIds`, ADR 0024): their name and
 * zone only, so that Suivi lists what was routed to him; every route behind still checks his rights (recette 05/11,
 * CHAT-01). `POST`: the owner adds one;
 * `PATCH /creators/:creatorId`: the owner renames her or moves her to another zone, with a recent sign-in (ADR 0071).
 * `/creators/:id/agent-hours`: her hours (P3-14), the owner's alone, a change with a recent sign-in.
 */
export function createCreatorRoutes(
  directory: CreatorDirectory,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators',
      {
        preValidation: requireRole('owner', 'operator', 'creator'),
        schema: { response: { 200: CreatorListSchema } },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const ids =
          user.role === 'owner'
            ? 'all'
            : [...new Set([...user.creatorIds, ...user.routedCreatorIds])].map((id) =>
                CreatorIdSchema.parse(id),
              );
        // An archived creator is in no list, the owner's included (ADR 0071 § 2): `/creators/archived` has them.
        return { creators: [...(await directory.unarchived(ids))] };
      },
    );

    app.post(
      '/creators',
      {
        // A new creator is the agency's call: the owner only (`pnpm creator:create` does the same).
        preValidation: requireRole('owner'),
        schema: { body: NewCreatorSchema, response: { 201: CreatorSummarySchema } },
      },
      async (request, reply) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        return reply.code(201).send(await directory.create(request.body, user.id));
      },
    );

    app.patch(
      '/creators/:creatorId',
      {
        // Her zone moves her day, her night and her hours, her name is what everyone reads: the owner's call, with a
        // recent sign-in, like her hours.
        preValidation: [requireRole('owner'), recentLogin],
        schema: {
          params: CreatorIdParamsSchema,
          body: UpdateCreatorBodySchema,
          response: { 200: CreatorSummarySchema },
        },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const { creatorId } = request.params;
        const { displayName, timezone } = request.body;
        // Her name first: a name already taken refuses the whole change, before her zone moves.
        let creator =
          displayName === undefined ? null : await directory.rename(creatorId, displayName, user.id);
        if (timezone !== undefined) creator = await directory.setTimezone(creatorId, timezone, user.id);
        if (creator === null) throw new CreatorNotFound();
        return creator;
      },
    );

    app.get(
      '/creators/:id/agent-hours',
      {
        preValidation: requireRole('owner'),
        schema: { params: CreatorParamsSchema, response: { 200: AgentHoursViewSchema } },
      },
      async (request) => {
        const view = await directory.agentHours(request.params.id);
        if (view === null) throw new CreatorNotFound();
        if (view.invalidStored)
          request.log.warn({ creatorId: request.params.id }, 'agent hours: stored setting unreadable');
        return view;
      },
    );

    app.put(
      '/creators/:id/agent-hours',
      {
        preValidation: [requireRole('owner'), recentLogin],
        schema: {
          params: CreatorParamsSchema,
          body: SetAgentHoursBodySchema,
          response: { 200: AgentHoursViewSchema },
        },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const { id } = request.params;
        if (!(await directory.setAgentHours(id, request.body.hours, user.id))) throw new CreatorNotFound();
        const view = await directory.agentHours(id);
        if (view === null) throw new CreatorNotFound();
        return view;
      },
    );
    return Promise.resolve();
  };
}

/** What her archiving needs from the other modules, given by the composition root (ADR 0071 § 2). */
export interface CreatorArchiving {
  /** What still plans someone on her (`scheduling`): she is archived only when both counts are zero. */
  planned(creatorId: CreatorId): Promise<CreatorPlanned>;
  /**
   * Closes what she still has open once she is archived: her links out are revoked, her agent stopped by its switch,
   * so it stays off when she is reopened. Run again on an archive asked twice, and harmless then.
   */
  close(input: { creatorId: CreatorId; userId: string; correlationId: string }): Promise<void>;
}

/**
 * `GET /v1/creators/archived`, `POST /v1/creators/:creatorId/archive` and `…/restore` (ADR 0071 § 2): the owner's
 * alone, a change with a recent sign-in. Nothing of hers is deleted; her history keeps her name.
 */
export function createCreatorArchiveRoutes(
  directory: CreatorDirectory,
  requireRole: RequireRole,
  recentLogin: preValidationAsyncHookHandler,
  archiving: CreatorArchiving,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/creators/archived',
      {
        preValidation: requireRole('owner'),
        schema: { response: { 200: ArchivedCreatorListSchema } },
      },
      async () => ({ creators: [...(await directory.archived())] }),
    );

    app.post(
      '/creators/:creatorId/archive',
      {
        preValidation: [requireRole('owner'), recentLogin],
        schema: { params: CreatorIdParamsSchema, response: { 200: ArchivedCreatorSchema } },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        const { creatorId } = request.params;
        // Still planned, nothing is archived: the owner ends her shifts in the agenda first, told how many remain.
        const planned = await archiving.planned(creatorId);
        if (planned.shiftsAhead > 0 || planned.templatesRunning > 0)
          throw new CreatorPlannedConflict(planned);
        const archived = await directory.archive(creatorId, user.id);
        if (archived === null) throw new CreatorNotFound();
        await archiving.close({ creatorId, userId: user.id, correlationId: request.id });
        return archived;
      },
    );

    app.post(
      '/creators/:creatorId/restore',
      {
        preValidation: [requireRole('owner'), recentLogin],
        schema: { params: CreatorIdParamsSchema, response: { 200: CreatorSummarySchema } },
      },
      async (request) => {
        const { user } = request;
        if (user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
        // Listed again, her agent still off and her space closed: the Dashboard resumes the one, a new link opens the
        // other.
        const restored = await directory.restore(request.params.creatorId, user.id);
        if (restored === null) throw new CreatorNotFound();
        return restored;
      },
    );
    return Promise.resolve();
  };
}
