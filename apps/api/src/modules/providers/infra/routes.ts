import {
  AiProviderSchema,
  ProviderOverviewSchema,
  ProviderRefusalSchema,
  ProviderSettingsSchema,
  ProviderStatusSchema,
  SaveProviderKeyBodySchema,
} from '@nirvana/contracts';
import type { FastifyRequest, preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import { checkPastedKey } from '../application/connections';
import type { ProvidersApi } from '../application/providers-api';
import { nextAction } from '../domain/next-action';
import type { KeyActor } from '../domain/ports';

const ProviderParamsSchema = z.object({ provider: AiProviderSchema });

/**
 * Each paste and each « Vérifier maintenant » calls the provider: per address, far below what a person does and
 * far below what would get Nirvana's own keys rate-limited by xAI or Google.
 */
const PROVIDER_CALLS_PER_MINUTE = 10;
const providerCallLimit = { rateLimit: { max: PROVIDER_CALLS_PER_MINUTE, timeWindow: '1 minute' } };

/** Who touches a key, for `audit_log`: the guard has set `request.user`. */
function actorOf(request: FastifyRequest): KeyActor {
  return { userId: request.user?.id ?? null, ip: request.ip };
}

/**
 * A key whose shape is plainly wrong (cut, or another service's) is refused before the password is asked: nothing is
 * saved nor called either way, and the sign-in quota is not spent on it. A body the contract refuses is left to
 * the route’s validation. Not a guard: it never lets anything through that the guards would stop.
 */
const refuseMalformedKey: preValidationAsyncHookHandler = async (request, reply) => {
  const params = ProviderParamsSchema.safeParse(request.params);
  const body = SaveProviderKeyBodySchema.safeParse(request.body);
  if (!params.success || !body.success) return;
  const checked = checkPastedKey(params.data.provider, body.data.key);
  if (!checked.ok) await reply.code(422).send(checked.error);
};

export interface ProvidersRoutesOptions {
  /** `requireRole('owner')` (P0-07a): keys are an agency setting, nobody else reads or changes them. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin` (ADR 0016): connecting, replacing or removing a key needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

/**
 * `/v1/settings/providers` (fiche P3-03, point 5). No answer ever carries a key; the request body is redacted from
 * the logs (`*.body`, logger.ts).
 */
export function createProvidersRoutes(
  providers: ProvidersApi,
  options: ProvidersRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    app.get('/settings/providers', { schema: { response: { 200: ProviderOverviewSchema } } }, async () => {
      const services = await providers.list();
      return { services: [...services], next: nextAction(services) };
    });

    app.put(
      '/settings/providers/:provider/key',
      {
        preValidation: [refuseMalformedKey, options.recentLogin],
        config: providerCallLimit,
        schema: {
          params: ProviderParamsSchema,
          body: SaveProviderKeyBodySchema,
          response: { 200: ProviderStatusSchema, 422: ProviderRefusalSchema },
        },
      },
      async (request, reply) => {
        const result = await providers.connect(request.params.provider, request.body.key, actorOf(request));
        return result.ok ? reply.send(result.value) : reply.code(422).send(result.error);
      },
    );

    app.post(
      '/settings/providers/:provider/verify',
      {
        config: providerCallLimit,
        schema: { params: ProviderParamsSchema, response: { 200: ProviderStatusSchema } },
      },
      (request) => providers.reverify(request.params.provider),
    );

    app.put(
      '/settings/providers/:provider/settings',
      {
        schema: {
          params: ProviderParamsSchema,
          body: ProviderSettingsSchema,
          response: { 200: ProviderStatusSchema },
        },
      },
      (request) => providers.updateSettings(request.params.provider, request.body),
    );

    app.delete(
      '/settings/providers/:provider',
      {
        preValidation: options.recentLogin,
        schema: { params: ProviderParamsSchema, response: { 200: ProviderStatusSchema } },
      },
      (request) => providers.disconnect(request.params.provider, actorOf(request)),
    );

    return Promise.resolve();
  };
}
