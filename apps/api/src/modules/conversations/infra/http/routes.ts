import {
  ApproveDraftBodySchema,
  ConversationDetailSchema,
  ConversationEventViewSchema,
  ConversationIdSchema,
  ConversationSummarySchema,
  CreatorIdSchema,
  DesireCurveSchema,
  DomainError,
  DraftIdSchema,
  MessageViewSchema,
  AgentModeResultSchema,
  BlindTestResultSchema,
  pageOf,
  PageQuerySchema,
  RecordBlindTestBodySchema,
  RejectDraftBodySchema,
  SetAgentModeBodySchema,
  SetModeBodySchema,
  ReleaseBodySchema,
  TakeoverBodySchema,
  UserIdSchema,
  type CreatorId,
  type CurrentUser,
  type UserId,
  type UserRole,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { ConversationCommands } from '../../application/commands';
import { ConversationNotFound } from '../../domain/errors';
import type { ConversationReader } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

class CreatorForbidden extends DomainError {
  constructor() {
    super('creator_forbidden', 'Créatrice hors de ton périmètre');
  }
}

const CreatorQuerySchema = z.object({ creatorId: CreatorIdSchema });
const ConversationParamsSchema = z.object({ id: ConversationIdSchema });
const DraftParamsSchema = ConversationParamsSchema.extend({ draftId: DraftIdSchema });
const CreatorParamsSchema = z.object({ id: CreatorIdSchema });

class ConversationForbidden extends DomainError {
  constructor() {
    super('conversation_forbidden', 'Cette conversation ne t’a pas été confiée');
  }
}

function signedIn(request: FastifyRequest): CurrentUser {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return request.user;
}

/** Whether the user reads every conversation of this creator: the owner, or a creator of his `creatorIds`. */
function readsWholeCreator(user: CurrentUser, creatorId: CreatorId): boolean {
  return user.role === 'owner' || user.creatorIds.includes(creatorId);
}

/** The signed-in user, allowed on the whole creator (her mode, her blind tests): never through routing. */
export function actorFor(
  request: FastifyRequest,
  creatorId: CreatorId,
): { user: CurrentUser; userId: UserId } {
  const user = signedIn(request);
  if (!readsWholeCreator(user, creatorId)) throw new CreatorForbidden();
  return { user, userId: UserIdSchema.parse(user.id) };
}

/** `/v1/conversations` (api.md): the inbox reads, and the operator's commands on drafts and on the conversation. */
export function createConversationRoutes(
  reader: ConversationReader,
  commands: ConversationCommands,
  guards: { readonly requireRole: RequireRole; readonly recentLogin: preValidationAsyncHookHandler },
): FastifyPluginAsyncZod {
  const { requireRole } = guards;

  /**
   * The signed-in user, allowed on this conversation: the whole creator, or (a team member whose scope is `self`,
   * ADR 0024) only a conversation routed to him; anything else is 403.
   */
  const actorOn = async (
    request: FastifyRequest,
    creatorId: CreatorId,
    conversationId: z.infer<typeof ConversationIdSchema>,
  ): Promise<UserId> => {
    const user = signedIn(request);
    const userId = UserIdSchema.parse(user.id);
    if (readsWholeCreator(user, creatorId)) return userId;
    if (!user.routedCreatorIds.includes(creatorId)) throw new CreatorForbidden();
    if (!(await reader.isRoutedTo(creatorId, conversationId, userId))) throw new ConversationForbidden();
    return userId;
  };

  return (app) => {
    // A creator never reads a conversation (ADR 0023): her fans' words stay with the agency.
    const read = { preValidation: requireRole('owner', 'operator') };
    const act = { preValidation: requireRole('owner', 'operator') };

    app.get(
      '/conversations',
      {
        ...read,
        schema: {
          querystring: CreatorQuerySchema.extend(PageQuerySchema.shape),
          response: { 200: pageOf(ConversationSummarySchema) },
        },
      },
      async (request) => {
        const { creatorId, limit, cursor } = request.query;
        const user = signedIn(request);
        let routedTo: UserId | undefined;
        if (!readsWholeCreator(user, creatorId)) {
          if (!user.routedCreatorIds.includes(creatorId)) throw new CreatorForbidden();
          routedTo = UserIdSchema.parse(user.id);
        }
        const page = await reader.list(creatorId, { limit, cursor }, routedTo);
        return { items: [...page.items], nextCursor: page.nextCursor };
      },
    );

    app.get(
      '/conversations/:id',
      {
        ...read,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: ConversationDetailSchema },
        },
      },
      async (request) => {
        await actorOn(request, request.query.creatorId, request.params.id);
        const detail = await reader.get(request.query.creatorId, request.params.id);
        if (detail === null) throw new ConversationNotFound();
        return detail;
      },
    );

    app.get(
      '/conversations/:id/messages',
      {
        ...read,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema.extend(PageQuerySchema.shape),
          response: { 200: pageOf(MessageViewSchema) },
        },
      },
      async (request) => {
        const { creatorId, limit, cursor } = request.query;
        await actorOn(request, creatorId, request.params.id);
        const page = await reader.messages(creatorId, request.params.id, { limit, cursor });
        if (page === null) throw new ConversationNotFound();
        return { items: [...page.items], nextCursor: page.nextCursor };
      },
    );

    app.get(
      '/conversations/:id/events',
      {
        ...read,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema.extend(PageQuerySchema.shape),
          response: { 200: pageOf(ConversationEventViewSchema) },
        },
      },
      async (request) => {
        const { creatorId, limit, cursor } = request.query;
        await actorOn(request, creatorId, request.params.id);
        const page = await reader.events(creatorId, request.params.id, { limit, cursor });
        if (page === null) throw new ConversationNotFound();
        return { items: [...page.items], nextCursor: page.nextCursor };
      },
    );

    // His desire curve (P3-12): the conversation's own rights, so a chatter reads it only while it is routed to him.
    app.get(
      '/conversations/:id/desire',
      {
        ...read,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: DesireCurveSchema },
        },
      },
      async (request) => {
        await actorOn(request, request.query.creatorId, request.params.id);
        const curve = await reader.desireCurve(request.query.creatorId, request.params.id);
        if (curve === null) throw new ConversationNotFound();
        return curve;
      },
    );

    const command = async (
      request: FastifyRequest,
      creatorId: CreatorId,
      conversationId: z.infer<typeof ConversationIdSchema>,
    ) => ({
      creatorId,
      conversationId,
      userId: await actorOn(request, creatorId, conversationId),
      correlationId: request.id,
    });

    app.post(
      '/conversations/:id/drafts/:draftId/approve',
      {
        ...act,
        schema: { params: DraftParamsSchema, querystring: CreatorQuerySchema, body: ApproveDraftBodySchema },
      },
      async (request, reply) => {
        await commands.approveDraft({
          ...(await command(request, request.query.creatorId, request.params.id)),
          draftId: request.params.draftId,
          ...(request.body.bubbles === undefined ? {} : { bubbles: request.body.bubbles }),
        });
        return reply.code(204).send();
      },
    );

    app.post(
      '/conversations/:id/drafts/:draftId/reject',
      {
        ...act,
        schema: { params: DraftParamsSchema, querystring: CreatorQuerySchema, body: RejectDraftBodySchema },
      },
      async (request, reply) => {
        await commands.rejectDraft({
          ...(await command(request, request.query.creatorId, request.params.id)),
          draftId: request.params.draftId,
          ...(request.body.reason === undefined ? {} : { reason: request.body.reason }),
        });
        return reply.code(204).send();
      },
    );

    app.post(
      '/conversations/:id/takeover',
      {
        ...act,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema,
          body: TakeoverBodySchema,
        },
      },
      async (request, reply) => {
        await commands.takeover({
          ...(await command(request, request.query.creatorId, request.params.id)),
          ...(request.body.reason === undefined ? {} : { reason: request.body.reason }),
        });
        return reply.code(204).send();
      },
    );

    app.post(
      '/conversations/:id/release',
      {
        ...act,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema,
          body: ReleaseBodySchema,
        },
      },
      async (request, reply) => {
        await commands.release({
          ...(await command(request, request.query.creatorId, request.params.id)),
          ...(request.body.note === undefined ? {} : { note: request.body.note }),
        });
        return reply.code(204).send();
      },
    );

    app.post(
      '/conversations/:id/mode',
      {
        ...act,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema,
          body: SetModeBodySchema,
        },
      },
      async (request, reply) => {
        // The conversation's mode is a supervisor's control: never through routing.
        const { userId } = actorFor(request, request.query.creatorId);
        await commands.setMode({
          creatorId: request.query.creatorId,
          conversationId: request.params.id,
          userId,
          correlationId: request.id,
          mode: request.body.mode,
        });
        return reply.code(204).send();
      },
    );

    // The Dashboard's control for every conversation of hers; Arrêt takes effect without a re-authentication.
    app.put(
      '/agent/mode',
      { ...act, schema: { body: SetAgentModeBodySchema, response: { 200: AgentModeResultSchema } } },
      async (request) => {
        const { creatorId, mode } = request.body;
        const { userId } = actorFor(request, creatorId);
        return commands.setAgentMode({ creatorId, userId, mode, correlationId: request.id });
      },
    );

    // The blind test of ADR 0019: the owner only, with a recent sign-in; the server stamps the voice version.
    app.post(
      '/creators/:id/blind-tests',
      {
        preValidation: [requireRole('owner'), guards.recentLogin],
        schema: {
          params: CreatorParamsSchema,
          body: RecordBlindTestBodySchema,
          response: { 201: BlindTestResultSchema },
        },
      },
      async (request, reply) => {
        const creatorId = request.params.id;
        const { userId } = actorFor(request, creatorId);
        const result = await commands.recordBlindTest({
          creatorId,
          userId,
          rate: request.body.rate,
          correlationId: request.id,
        });
        return reply.code(201).send(result);
      },
    );

    return Promise.resolve();
  };
}
