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
  SendingStopSchema,
  SetModeBodySchema,
  CloseCareBodySchema,
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
import {
  createConversationReads,
  readsWholeCreator,
  viewerOf,
  type ConversationViewer,
} from '../../application/reads';
import { ConversationForbidden, CreatorForbidden } from '../../domain/errors';
import type { ConversationReader } from '../../domain/ports';

/** The composition root's `requireRole`: 401 without a session, 403 with another role; sets `request.user`. */
export type RequireRole = (...roles: UserRole[]) => preValidationAsyncHookHandler;

const CreatorQuerySchema = z.object({ creatorId: CreatorIdSchema });
const ConversationParamsSchema = z.object({ id: ConversationIdSchema });
const DraftParamsSchema = ConversationParamsSchema.extend({ draftId: DraftIdSchema });
const CreatorParamsSchema = z.object({ id: CreatorIdSchema });

function signedIn(request: FastifyRequest): CurrentUser {
  if (request.user === null) throw new DomainError('session_unauthenticated', 'Connexion requise');
  return request.user;
}

/** The signed-in user as the conversation reads see him (ADR 0026 § 1): 401 without a session. */
function viewerAt(request: FastifyRequest): ConversationViewer {
  return viewerOf(signedIn(request));
}

/** The signed-in user, allowed on the whole creator (her mode, her blind tests): never through routing. */
export function actorFor(
  request: FastifyRequest,
  creatorId: CreatorId,
): { user: CurrentUser; userId: UserId } {
  const user = signedIn(request);
  if (!readsWholeCreator(viewerOf(user), creatorId)) throw new CreatorForbidden();
  return { user, userId: UserIdSchema.parse(user.id) };
}

/** `/v1/conversations` (api.md): the inbox reads, and the operator's commands on drafts and on the conversation. */
export function createConversationRoutes(
  reader: ConversationReader,
  commands: ConversationCommands,
  guards: { readonly requireRole: RequireRole; readonly recentLogin: preValidationAsyncHookHandler },
): FastifyPluginAsyncZod {
  const { requireRole } = guards;

  const reads = createConversationReads(reader);
  const actorOn = (
    request: FastifyRequest,
    creatorId: CreatorId,
    conversationId: z.infer<typeof ConversationIdSchema>,
  ): Promise<UserId> => reads.actorOn(viewerAt(request), creatorId, conversationId);

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

    // Whether the emergency stop holds her messages (recette CHAT-07): whoever lists her conversations reads it, a
    // chatter for a creator routed to him too, so that Suivi says it before a decision.
    app.get(
      '/conversations/stop',
      { ...read, schema: { querystring: CreatorQuerySchema, response: { 200: SendingStopSchema } } },
      async (request) => {
        return { stopped: await reads.stopped(viewerAt(request), request.query.creatorId) };
      },
    );

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
        const page = await reads.list(viewerAt(request), creatorId, { limit, cursor });
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
        return reads.get(viewerAt(request), request.query.creatorId, request.params.id, { ip: request.ip });
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
        const page = await reads.messages(
          viewerAt(request),
          creatorId,
          request.params.id,
          { limit, cursor },
          {
            ip: request.ip,
          },
        );
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
        const page = await reads.events(
          viewerAt(request),
          creatorId,
          request.params.id,
          { limit, cursor },
          {
            ip: request.ip,
          },
        );
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
        return reads.desire(viewerAt(request), request.query.creatorId, request.params.id, {
          ip: request.ip,
        });
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
          !readsWholeCreator(viewerAt(request), creatorId) &&
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

    // « Il va mieux » (ADR 0088 § 7): the owner or a manager closes the care mode, never a chatter.
    app.post(
      '/conversations/:id/care/close',
      {
        ...act,
        schema: {
          params: ConversationParamsSchema,
          querystring: CreatorQuerySchema,
          body: CloseCareBodySchema,
        },
      },
      async (request, reply) => {
        const { userId } = actorFor(request, request.query.creatorId);
        await commands.closeCare({
          creatorId: request.query.creatorId,
          conversationId: request.params.id,
          userId,
          correlationId: request.id,
          ...(request.body.reason === undefined ? {} : { reason: request.body.reason }),
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
