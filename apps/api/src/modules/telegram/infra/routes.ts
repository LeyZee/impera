import {
  ChannelTryRefusalBodySchema,
  CreatorIdSchema,
  RefusalError,
  TELEGRAM_CHANNEL_TRY_REFUSED,
  TriedChannelPostSchema,
  TryChannelPostBodySchema,
  SaveTelegramChannelBodySchema,
  TELEGRAM_CHANNEL_INVALID,
  TelegramChannelRefusalBodySchema,
  TelegramChannelViewSchema,
  SaveTelegramRoutesBodySchema,
  SaveTelegramTokenBodySchema,
  TelegramBotIdSchema,
  TelegramBotSchema,
  TelegramChatIdSchema,
  TelegramDeliveriesSchema,
  TELEGRAM_ROUTES_CONFLICT,
  TELEGRAM_TEST_UNPROCESSABLE,
  TELEGRAM_TOKEN_UNPROCESSABLE,
  TelegramOverviewSchema,
  TelegramRefusalBodySchema,
  TelegramRoutesSchema,
  TelegramSalesSettingsSchema,
  TelegramTestResultSchema,
  TelegramTopicSchema,
  type ChannelTryRefusalKind,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TelegramApi } from '../application/api';
import {
  TelegramBotNotFound,
  TelegramChatInvalid,
  TelegramChatMemberConflict,
  TelegramChannelCreatorNotFound,
  TelegramChatNotFound,
  TelegramCreatorInvalid,
  TelegramRouteToChannel,
} from '../domain/errors';

export interface TelegramRoutesOptions {
  /** `requireRole('owner')`: bots and routing are agency settings. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0016): adding, replacing or removing a bot needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

const BotParamsSchema = z.object({ id: TelegramBotIdSchema });
const ChatParamsSchema = z.object({ id: TelegramChatIdSchema });
const CreatorParamsSchema = z.object({ creatorId: CreatorIdSchema });

const TRY_REFUSALS: Readonly<Record<ChannelTryRefusalKind, string>> = {
  no_persona: 'Elle n’a pas de persona active : active une version dans Créatrices › Persona.',
  link_unknown: 'Ce lien n’existe plus dans son canal : choisis-en un autre.',
  llm_unavailable: 'Aucun modèle n’a répondu, ou le budget du jour est atteint. Réessaie plus tard.',
};

/**
 * `/v1/settings/telegram` (task P3-07). No answer ever carries a token; the request body is redacted from the logs
 * (`*.body`, logger.ts).
 */
export function createTelegramRoutes(
  telegram: TelegramApi,
  options: TelegramRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get('/settings/telegram', { schema: { response: { 200: TelegramOverviewSchema } } }, () =>
      telegram.overview(),
    );

    app.post(
      '/settings/telegram/bots',
      {
        preValidation: options.recentLogin,
        schema: {
          body: SaveTelegramTokenBodySchema,
          response: { 201: TelegramBotSchema, 422: TelegramRefusalBodySchema },
        },
      },
      async (request, reply) => {
        const result = await telegram.addBot(request.body.token);
        if (!result.ok) throw new RefusalError(TELEGRAM_TOKEN_UNPROCESSABLE, result.error);
        return reply.code(201).send(result.value);
      },
    );

    app.put(
      '/settings/telegram/bots/:id/token',
      {
        preValidation: options.recentLogin,
        schema: {
          params: BotParamsSchema,
          body: SaveTelegramTokenBodySchema,
          response: { 200: TelegramBotSchema, 422: TelegramRefusalBodySchema },
        },
      },
      async (request) => {
        const result = await telegram.replaceToken(request.params.id, request.body.token);
        if (result === null) throw new TelegramBotNotFound();
        if (!result.ok) throw new RefusalError(TELEGRAM_TOKEN_UNPROCESSABLE, result.error);
        return result.value;
      },
    );

    app.post(
      '/settings/telegram/bots/:id/listen',
      { schema: { params: BotParamsSchema, response: { 202: z.null() } } },
      async (request, reply) => {
        if (!(await telegram.listen(request.params.id))) throw new TelegramBotNotFound();
        return reply.code(202).send(null);
      },
    );

    app.delete(
      '/settings/telegram/bots/:id',
      {
        preValidation: options.recentLogin,
        schema: { params: BotParamsSchema, response: { 204: z.null() } },
      },
      async (request, reply) => {
        if (!(await telegram.removeBot(request.params.id))) throw new TelegramBotNotFound();
        return reply.code(204).send(null);
      },
    );

    app.post(
      '/settings/telegram/chats/:id/test',
      {
        schema: {
          params: ChatParamsSchema,
          response: { 200: TelegramTestResultSchema, 422: TelegramRefusalBodySchema },
        },
      },
      async (request) => {
        const result = await telegram.sendTest(request.params.id);
        if (result === null) throw new TelegramChatNotFound();
        if (!result.ok) throw new RefusalError(TELEGRAM_TEST_UNPROCESSABLE, result.error);
        return result.value;
      },
    );

    // REG-28: « Retirer de la liste », only a group the bot left or was banned from. No token is touched: the owner's
    // guard is enough, without the password asked again.
    app.delete(
      '/settings/telegram/chats/:id',
      { schema: { params: ChatParamsSchema, response: { 204: z.null() } } },
      async (request, reply) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const result = await telegram.removeChat(request.params.id, request.user.id);
        if (result === 'missing') throw new TelegramChatNotFound();
        if (result === 'refused') throw new TelegramChatMemberConflict();
        return reply.code(204).send(null);
      },
    );

    app.get('/settings/telegram/sales', { schema: { response: { 200: TelegramSalesSettingsSchema } } }, () =>
      telegram.saleSettings(),
    );

    app.put(
      '/settings/telegram/sales',
      { schema: { body: TelegramSalesSettingsSchema, response: { 200: TelegramSalesSettingsSchema } } },
      async (request) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const result = await telegram.saveSaleSettings(request.body.settings, request.user.id);
        if (!result.ok) throw new TelegramCreatorInvalid();
        return result.value;
      },
    );

    app.put(
      '/settings/telegram/routes',
      {
        schema: {
          body: SaveTelegramRoutesBodySchema,
          response: { 200: TelegramRoutesSchema, 409: TelegramRefusalBodySchema },
        },
      },
      async (request) => {
        const result = await telegram.saveRoutes(request.body.version, request.body.routes);
        if (result.ok) return result.value;
        if (result.error === 'unknown_chat') throw new TelegramChatInvalid();
        if (result.error === 'creator_channel') throw new TelegramRouteToChannel();
        throw new RefusalError(TELEGRAM_ROUTES_CONFLICT, result.error);
      },
    );

    app.get(
      '/settings/telegram/deliveries',
      {
        schema: {
          querystring: z.object({
            topic: TelegramTopicSchema.optional(),
            limit: z.coerce.number().int().min(1).max(200).default(50),
          }),
          response: { 200: TelegramDeliveriesSchema },
        },
      },
      async (request) => ({
        deliveries: await telegram.listDeliveries(request.query.topic ?? null, request.query.limit),
      }),
    );

    // ADR 0080 § 6: Réglages › Créatrices › Canal Telegram. A change asks for a sign-in under 10 minutes: the redirect
    // links decide where her readers land.
    app.get(
      '/creators/:creatorId/telegram-channel',
      { schema: { params: CreatorParamsSchema, response: { 200: TelegramChannelViewSchema } } },
      async (request) => {
        const view = await telegram.channel(request.params.creatorId);
        if (view === null) throw new TelegramChannelCreatorNotFound();
        return view;
      },
    );

    app.put(
      '/creators/:creatorId/telegram-channel',
      {
        preValidation: options.recentLogin,
        schema: {
          params: CreatorParamsSchema,
          body: SaveTelegramChannelBodySchema,
          response: { 200: TelegramChannelViewSchema, 400: TelegramChannelRefusalBodySchema },
        },
      },
      async (request) => {
        if (request.user === null) throw new Error('requireRole ran without a user');
        const result = await telegram.saveChannel(
          request.params.creatorId,
          request.body.config,
          request.user.id,
        );
        if (result === null) throw new TelegramChannelCreatorNotFound();
        if (!result.ok) throw new RefusalError(TELEGRAM_CHANNEL_INVALID, result.error);
        return result.value;
      },
    );

    // ADR 0080 § 7: the playground's « Post du canal », written as production will and never sent. A model call each
    // time, journaled against her under the daily cap.
    app.post(
      '/creators/:creatorId/telegram-channel/try',
      {
        schema: {
          params: CreatorParamsSchema,
          body: TryChannelPostBodySchema,
          response: { 200: TriedChannelPostSchema, 400: ChannelTryRefusalBodySchema },
        },
      },
      async (request) => {
        const result = await telegram.tryChannelPost(request.params.creatorId, request.body);
        if (result === null) throw new TelegramChannelCreatorNotFound();
        if (!result.ok) {
          throw new RefusalError(TELEGRAM_CHANNEL_TRY_REFUSED, {
            kind: result.error,
            message: TRY_REFUSALS[result.error],
          });
        }
        return result.value;
      },
    );

    return Promise.resolve();
  };
}
