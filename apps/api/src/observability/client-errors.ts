import {
  ClientErrorReportSchema,
  DomainError,
  limitKeyOf,
  UserRoleSchema,
  type ClientErrorErrorCode,
} from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { RequireRole } from '../auth';

import type { ErrorReporter } from './error-reporter';

/**
 * Reports per account and per window: a screen that fails in a loop says so a few times, never floods Sentry. Bounds of
 * its own: the shared store names a limiter without a route by its bounds (`rate-limit-store.ts`), and 10 per 10 minutes
 * is the confirmation's.
 */
const REPORTS_PER_ACCOUNT = 12;
const REPORTS_WINDOW = '15 minutes';

class ClientErrorLimited extends DomainError {
  constructor() {
    super(
      'client_error_limited' satisfies ClientErrorErrorCode,
      'Trop de rapports d’erreur : les suivants attendront quelques minutes',
    );
  }
}

export interface ClientErrorRoutesDeps {
  readonly requireRole: RequireRole;
  readonly reporter: ErrorReporter;
}

/**
 * `POST /v1/client-errors` (OPS-18): the dashboard's own errors, forwarded to Sentry through the API's scrubber, tagged
 * `service=web`. Signed in only, from the dashboard's origin (the server's check), its own limit per account on the shared
 * counters (ADR 0027). 204 whatever Sentry does, and 204 without a DSN: nothing is kept, nothing is logged of its body.
 */
export function createClientErrorRoutes(deps: ClientErrorRoutesDeps): FastifyPluginAsyncZod {
  const { requireRole, reporter } = deps;
  return (app) => {
    const perAccount = app.createRateLimit({
      max: REPORTS_PER_ACCOUNT,
      timeWindow: REPORTS_WINDOW,
      keyGenerator: (request) => `client-errors:${request.user?.id ?? limitKeyOf(request.ip)}`,
      // Fail-open like the API-wide limit: a report is never worth a 503, and the guard has read the session already.
      skipOnError: true,
    });
    app.post(
      '/client-errors',
      {
        preValidation: [
          requireRole(...UserRoleSchema.options),
          async (request, reply) => {
            const attempt = await perAccount(request);
            if (attempt.isAllowed || !attempt.isExceeded) return;
            void reply.header('retry-after', attempt.ttlInSeconds);
            throw new ClientErrorLimited();
          },
        ],
        schema: { body: ClientErrorReportSchema },
      },
      async (request, reply) => {
        reporter.captureClientError(request.body);
        return reply.code(204).send();
      },
    );
    return Promise.resolve();
  };
}
