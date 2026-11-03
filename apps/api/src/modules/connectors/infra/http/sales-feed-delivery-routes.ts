import { PlatformSchema } from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

import type { SalesFeeds } from '../../application/sales-feed';

const PlatformParamsSchema = z.object({ platform: PlatformSchema });

/** A delivery carries one line of the register: a few hundred bytes. */
const DELIVERY_BODY_LIMIT_BYTES = 64 * 1024;
/** A burst of sales is a few deliveries a second at most; past this, the platform retries later. */
const DELIVERIES_PER_MINUTE = 300;

/**
 * `POST /v1/webhooks/sales-feeds/:platform` (ADR 0050 § 3): a platform's delivery. Public and exempt from the
 * dashboard's Origin check, authenticated by its signature over the raw bytes, which is why the body is kept as a
 * Buffer here and parsed only once the signature holds. Nothing of the body is logged nor kept but the delivery's id
 * and position: the line is read again by cursor. 204 once in the inbox (a second sending too), 401 when it does not
 * pass, 404 when no webhook is registered for the platform.
 */
export function createSalesFeedDeliveryRoutes(feeds: SalesFeeds): FastifyPluginAsyncZod {
  return (app) => {
    app.removeContentTypeParser('application/json');
    app.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: DELIVERY_BODY_LIMIT_BYTES },
      (_request, body, done) => {
        done(null, body);
      },
    );

    app.post(
      '/webhooks/sales-feeds/:platform',
      {
        config: { originCheck: false, rateLimit: { max: DELIVERIES_PER_MINUTE, timeWindow: '1 minute' } },
        schema: { params: PlatformParamsSchema, body: z.instanceof(Buffer) },
      },
      async (request, reply) => {
        await feeds.receive(request.params.platform, request.body, headersOf(request.headers), request.log);
        return reply.code(204).send();
      },
    );

    return Promise.resolve();
  };
}

/** The headers as strings, a repeated one dropped: a signature given twice is no signature. */
function headersOf(headers: Readonly<Record<string, string | string[] | undefined>>): Record<string, string> {
  const single: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) if (typeof value === 'string') single[name] = value;
  return single;
}
