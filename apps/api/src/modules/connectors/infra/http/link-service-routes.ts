import {
  LINK_SERVICE_UNPROCESSABLE,
  LinkServiceRefusalBodySchema,
  LinkServiceStatusSchema,
  RefusalError,
  SaveLinkServiceKeyBodySchema,
  limitKeyOf,
} from '@impera/contracts';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { LinkServiceSettings } from '../../application/link-service';

/** Each paste calls the service once: far below a person's pace and the service's own limit. */
const KEY_CALLS_PER_MINUTE = 5;

export interface LinkServiceRoutesOptions {
  /** `requireRole('owner')`: the key is an agency setting. */
  readonly guard: preValidationAsyncHookHandler;
  /** `requireRecentLogin`: connecting, replacing or removing the key. */
  readonly recentLogin: preValidationAsyncHookHandler;
}

/** The common 429 `rate_limited` (server.ts), as the plugin's own limits answer. */
class OwnerLimitReached extends Error {
  readonly statusCode = 429;

  constructor() {
    super('owner limit reached');
    this.name = 'OwnerLimitReached';
  }
}

/**
 * `/v1/settings/link-service` (INS-02): the agency's key of the redirect service, for the owner alone. No answer
 * ever carries the key, even masked, nor the address of the service; the request body is redacted from the logs
 * (`*.body`, logger.ts).
 */
export function createLinkServiceRoutes(
  settings: LinkServiceSettings,
  options: LinkServiceRoutesOptions,
): FastifyPluginAsyncZod {
  return (app) => {
    app.addHook('preValidation', options.guard);

    // Counted per owner and address, after the guard: a refused call never spends the owner's quota.
    const limit = app.createRateLimit({
      max: KEY_CALLS_PER_MINUTE,
      timeWindow: '1 minute',
      keyGenerator: (request) => `link-service:${request.user?.id ?? ''}:${limitKeyOf(request.ip)}`,
    });
    const keyCalls: preValidationAsyncHookHandler = async (request, reply) => {
      const attempt = await limit(request);
      if (attempt.isAllowed || !attempt.isExceeded) return;
      void reply.header('retry-after', attempt.ttlInSeconds);
      throw new OwnerLimitReached();
    };

    app.get('/settings/link-service', { schema: { response: { 200: LinkServiceStatusSchema } } }, () =>
      settings.status(),
    );

    app.put(
      '/settings/link-service/key',
      {
        preValidation: [options.recentLogin, keyCalls],
        schema: {
          body: SaveLinkServiceKeyBodySchema,
          response: { 200: LinkServiceStatusSchema, 422: LinkServiceRefusalBodySchema },
        },
      },
      async (request) => {
        const result = await settings.connect(request.body.key, {
          userId: request.user?.id ?? null,
          ip: request.ip,
        });
        if (!result.ok) throw new RefusalError(LINK_SERVICE_UNPROCESSABLE, result.error);
        return result.value;
      },
    );

    app.delete(
      '/settings/link-service',
      { preValidation: options.recentLogin, schema: { response: { 200: LinkServiceStatusSchema } } },
      (request) => settings.disconnect({ userId: request.user?.id ?? null, ip: request.ip }),
    );

    return Promise.resolve();
  };
}
