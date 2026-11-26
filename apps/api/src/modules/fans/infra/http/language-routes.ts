import {
  CreatorIdSchema,
  FanIdSchema,
  FanLanguageViewSchema,
  SetFanLanguageBodySchema,
  type FanId,
  type FanLanguageView,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { FansService } from '../../application/fans';
import type { KeptLanguage } from '../../domain/fan';

import { noFanAccess, readerFor, type FanAccess, type RequireRole } from './flag-routes';

const FanParamsSchema = z.object({ id: FanIdSchema });
const CreatorQuerySchema = z.object({ creatorId: CreatorIdSchema });

const viewOf = (fanId: FanId, language: KeptLanguage | null): FanLanguageView => ({
  fanId,
  language:
    language === null
      ? null
      : {
          value: language.value,
          source: language.source,
          setBy: language.setBy,
          setAt: language.setAt.toISOString(),
        },
});

/**
 * `/v1/fans/:id/language` (ADR 0168 § 3): his kept language, read and set by those who read and correct his card (the
 * owner, the chatters on her list, a chatter whose access window is open on her or who holds a conversation of his,
 * each read traced, ADR 0025), never the creator. A person's choice is in the audit log and code never overwrites it.
 * A fan unknown to this creator is 404.
 */
export function createLanguageRoutes(
  fans: FansService,
  requireRole: RequireRole,
  access: FanAccess = noFanAccess,
): FastifyPluginAsyncZod {
  return (app) => {
    app.get(
      '/fans/:id/language',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: FanParamsSchema,
          querystring: CreatorQuerySchema,
          response: { 200: FanLanguageViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const fanId = request.params.id;
        await readerFor(request, creatorId, fanId, access, 'card');
        return viewOf(fanId, await fans.language(creatorId, fanId));
      },
    );

    app.put(
      '/fans/:id/language',
      {
        preValidation: requireRole('owner', 'operator'),
        schema: {
          params: FanParamsSchema,
          querystring: CreatorQuerySchema,
          body: SetFanLanguageBodySchema,
          response: { 200: FanLanguageViewSchema },
        },
      },
      async (request) => {
        const { creatorId } = request.query;
        const fanId = request.params.id;
        // The same reader as a field of his card writes it (card-routes.ts).
        const userId = await readerFor(request, creatorId, fanId, access, 'card');
        const kept = await fans.setLanguage(creatorId, fanId, request.body.language, {
          userId,
          ip: request.ip,
        });
        return viewOf(fanId, kept);
      },
    );
    return Promise.resolve();
  };
}
