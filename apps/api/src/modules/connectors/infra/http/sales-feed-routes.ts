import {
  LinkSalesFeedChatterBodySchema,
  LinkSalesFeedModelBodySchema,
  PlatformSchema,
  SalesFeedListSchema,
  SalesFeedOverviewSchema,
  SalesFeedRefusalSchema,
  SalesFeedStatusSchema,
  SaveSalesFeedKeyBodySchema,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { SalesFeeds } from '../../application/sales-feed';
import type { KeyActor } from '../../domain/sales-feed';

const PlatformParamsSchema = z.object({ platform: PlatformSchema });
const opaqueId = z.string().min(1).max(200);
const ModelParamsSchema = PlatformParamsSchema.extend({ platformModelId: opaqueId });
const ChatterParamsSchema = PlatformParamsSchema.extend({ platformChatterId: opaqueId });

/** Each paste calls Reveal twice: per address, far below a person's pace and Reveal's 200 calls a minute. */
const KEY_CALLS_PER_MINUTE = 10;

export interface SalesFeedRoutesOptions {
  /** `requireRole('owner')`: the key and the links are agency settings (ADR 0050 § 4). */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0016, ADR 0046): connecting, replacing or removing the key. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

function actorOf(request: FastifyRequest): KeyActor {
  return { userId: request.user?.id ?? null, ip: request.ip };
}

/**
 * `/v1/settings/sales-feeds` (CRM-01): the key of a platform's sales feed and the owner's links. No answer ever
 * carries the key, even masked; the request body is redacted from the logs (`*.body`, logger.ts).
 */
export function createSalesFeedRoutes(
  feeds: SalesFeeds,
  options: SalesFeedRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get('/settings/sales-feeds', { schema: { response: { 200: SalesFeedListSchema } } }, async () => ({
      feeds: await feeds.list(),
    }));

    app.get(
      '/settings/sales-feeds/:platform',
      { schema: { params: PlatformParamsSchema, response: { 200: SalesFeedOverviewSchema } } },
      (request) => feeds.overview(request.params.platform),
    );

    app.put(
      '/settings/sales-feeds/:platform/key',
      {
        preValidation: options.recentLogin,
        config: { rateLimit: { max: KEY_CALLS_PER_MINUTE, timeWindow: '1 minute' } },
        schema: {
          params: PlatformParamsSchema,
          body: SaveSalesFeedKeyBodySchema,
          response: { 200: SalesFeedStatusSchema, 422: SalesFeedRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await feeds.connect(request.params.platform, request.body.key, actorOf(request));
        return result.ok ? reply.send(result.value) : reply.code(422).send(result.error);
      },
    );

    app.delete(
      '/settings/sales-feeds/:platform',
      {
        preValidation: options.recentLogin,
        schema: { params: PlatformParamsSchema, response: { 200: SalesFeedStatusSchema } },
      },
      (request) => feeds.disconnect(request.params.platform, actorOf(request)),
    );

    app.put(
      '/settings/sales-feeds/:platform/webhook',
      {
        preValidation: options.recentLogin,
        config: { rateLimit: { max: KEY_CALLS_PER_MINUTE, timeWindow: '1 minute' } },
        schema: {
          params: PlatformParamsSchema,
          response: { 200: SalesFeedStatusSchema, 422: SalesFeedRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await feeds.connectWebhook(request.params.platform, actorOf(request));
        return result.ok ? reply.send(result.value) : reply.code(422).send(result.error);
      },
    );

    app.delete(
      '/settings/sales-feeds/:platform/webhook',
      {
        preValidation: options.recentLogin,
        schema: { params: PlatformParamsSchema, response: { 200: SalesFeedStatusSchema } },
      },
      (request) => feeds.disconnectWebhook(request.params.platform, actorOf(request)),
    );

    app.put(
      '/settings/sales-feeds/:platform/models/:platformModelId',
      {
        schema: {
          params: ModelParamsSchema,
          body: LinkSalesFeedModelBodySchema,
          response: { 200: SalesFeedOverviewSchema },
        },
      },
      (request) =>
        feeds.linkModel(
          request.params.platform,
          request.params.platformModelId,
          request.body.platformAccountId,
          request.user?.id ?? null,
        ),
    );

    app.put(
      '/settings/sales-feeds/:platform/chatters/:platformChatterId',
      {
        schema: {
          params: ChatterParamsSchema,
          body: LinkSalesFeedChatterBodySchema,
          response: { 200: SalesFeedOverviewSchema },
        },
      },
      (request) =>
        feeds.linkChatter(
          request.params.platform,
          request.params.platformChatterId,
          request.body,
          request.user?.id ?? null,
        ),
    );

    return Promise.resolve();
  };
}
