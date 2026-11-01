import {
  SaveTelegramRoutesBodySchema,
  SaveTelegramTokenBodySchema,
  TelegramBotIdSchema,
  TelegramBotSchema,
  TelegramChatIdSchema,
  TelegramDeliveriesSchema,
  TelegramOverviewSchema,
  TelegramRefusalSchema,
  TelegramRoutesSchema,
  TelegramTestResultSchema,
  TelegramTopicSchema,
} from '@nirvana/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { TelegramApi } from '../application/api';
import {
  TelegramBotNotFound,
  TelegramChatInvalid,
  TelegramChatMemberConflict,
  TelegramChatNotFound,
} from '../domain/errors';

export interface TelegramRoutesOptions {
  /** `requireRole('owner')`: bots and routing are agency settings. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0016): adding, replacing or removing a bot needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

const BotParamsSchema = z.object({ id: TelegramBotIdSchema });
const ChatParamsSchema = z.object({ id: TelegramChatIdSchema });

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
          response: { 201: TelegramBotSchema, 422: TelegramRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await telegram.addBot(request.body.token);
        return result.ok ? reply.code(201).send(result.value) : reply.code(422).send(result.error);
      },
    );

    app.put(
      '/settings/telegram/bots/:id/token',
      {
        preValidation: options.recentLogin,
        schema: {
          params: BotParamsSchema,
          body: SaveTelegramTokenBodySchema,
          response: { 200: TelegramBotSchema, 422: TelegramRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await telegram.replaceToken(request.params.id, request.body.token);
        if (result === null) throw new TelegramBotNotFound();
        return result.ok ? reply.send(result.value) : reply.code(422).send(result.error);
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
          response: { 200: TelegramTestResultSchema, 422: TelegramRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await telegram.sendTest(request.params.id);
        if (result === null) throw new TelegramChatNotFound();
        return result.ok ? reply.send(result.value) : reply.code(422).send(result.error);
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

    app.put(
      '/settings/telegram/routes',
      {
        schema: {
          body: SaveTelegramRoutesBodySchema,
          response: { 200: TelegramRoutesSchema, 409: TelegramRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await telegram.saveRoutes(request.body.version, request.body.routes);
        if (result.ok) return reply.send(result.value);
        if (result.error === 'unknown_chat') throw new TelegramChatInvalid();
        return reply.code(409).send(result.error);
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

    return Promise.resolve();
  };
}
