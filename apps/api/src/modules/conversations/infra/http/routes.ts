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
} from '@impera/contracts';
import type { FastifyReply, FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
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

/**
 * Whether the user reads and treats every conversation of this creator: the whole creator, or a chatter whose access
 * window is open on her (ADR 0025, EQ-13). Never her mode nor her blind tests: those stay `actorFor`'s.
 */
function treatsEveryConversation(user: CurrentUser, creatorId: CreatorId): boolean {
  return readsWholeCreator(user, creatorId) || user.shiftCreatorIds.includes(creatorId);
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
   * The signed-in user, allowed on this conversation: the whole creator, a chatter in his access window on her (ADR
   * 0025), or (a team member whose scope is `self`, ADR 0024) only a conversation he holds, routed to him or taken
   * over by him and not given back; anything else is 403.
   */
  const actorOn = async (
    request: FastifyRequest,
    creatorId: CreatorId,
    conversationId: z.infer<typeof ConversationIdSchema>,
  ): Promise<UserId> => {
    const user = signedIn(request);
    const userId = UserIdSchema.parse(user.id);
    if (treatsEveryConversation(user, creatorId)) return userId;
    if (!user.routedCreatorIds.includes(creatorId)) throw new CreatorForbidden();
    if (!(await reader.isHeldBy(creatorId, conversationId, userId))) throw new ConversationForbidden();
    return userId;
  };

  /**
   * `actorOn` for a read of the conversation and its fan's sheet: a chatter's is written in the audit log first, never
   * what he read (ADR 0025), and a conversation the creator does not have answers 404 before anything is read.
   */
  const readerOn = async (
    request: FastifyRequest,
    creatorId: CreatorId,
    conversationId: z.infer<typeof ConversationIdSchema>,
    via?: 'messages' | 'events' | 'desire',
  ): Promise<UserId> => {
    const userId = await actorOn(request, creatorId, conversationId);
    if (readsWholeCreator(signedIn(request), creatorId)) return userId;
    const trace = { userId, ip: request.ip, ...(via === undefined ? {} : { via }) };
    if (!(await reader.traceOpening(creatorId, conversationId, trace))) throw new ConversationNotFound();
    return userId;
  };

  return (app) => {
    // A creator never reads a conversation (ADR 0023): her fans' words stay with the agency.
    const read = { preValidation: requireRole('owner', 'operator') };
    const act = { preValidation: requireRole('owner', 'operator') };
    /**
     * Automatique sends without anyone reading first: whoever turns it on, owner or manager, gave the password and the
     * code less than 10 minutes ago (recette 05/11, reco 9), otherwise 403 `reauthentication_forbidden` and the page
     * asks again. Arrêt and Copilote never ask: stopping must never wait. Called once the body is validated.
     */
    const confirmAutomatic = async (request: FastifyRequest, reply: FastifyReply, mode: string) => {
      if (mode === 'auto') await guards.recentLogin.call(app, request, reply);
    };

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
        const heldOnly = !treatsEveryConversation(user, creatorId);
        if (heldOnly && !user.routedCreatorIds.includes(creatorId)) throw new CreatorForbidden();
        const page = await reader.list(
          creatorId,
          { limit, cursor },
          { userId: UserIdSchema.parse(user.id), heldOnly },
        );
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
        const userId = await readerOn(request, request.query.creatorId, request.params.id);
        const detail = await reader.get(request.query.creatorId, request.params.id, userId);
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
        await readerOn(request, creatorId, request.params.id, 'messages');
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
        await readerOn(request, creatorId, request.params.id, 'events');
        const page = await reader.events(creatorId, request.params.id, { limit, cursor });
        if (page === null) throw new ConversationNotFound();
        return { items: [...page.items], nextCursor: page.nextCursor };
      },
    );

    // His desire curve (P3-12): the conversation's own rights, so a chatter reads it in his window or while he holds it.
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
        await readerOn(request, request.query.creatorId, request.params.id, 'desire');
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
        const { creatorId } = request.query;
        const input = await command(request, creatorId, request.params.id);
        // A chatter gives back the hand he holds, or in his window a handoff nobody took (he is the one on shift),
        // never another person's (ADR 0025): the owner and a manager who reads the whole creator give back any.
        if (
          !readsWholeCreator(signedIn(request), creatorId) &&
          (await reader.holderOf(creatorId, request.params.id, input.userId)) === 'other'
        ) {
          throw new ConversationForbidden();
        }
        await commands.release({
          ...input,
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
        await confirmAutomatic(request, reply, request.body.mode);
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

    // The Dashboard's control for every conversation of hers; Arrêt takes effect without a re-authentication, Automatique asks one.
    app.put(
      '/agent/mode',
      { ...act, schema: { body: SetAgentModeBodySchema, response: { 200: AgentModeResultSchema } } },
      async (request, reply) => {
        const { creatorId, mode } = request.body;
        const { userId } = actorFor(request, creatorId);
        await confirmAutomatic(request, reply, mode);
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
