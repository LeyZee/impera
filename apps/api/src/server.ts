import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit, { type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { DomainError, type ApiError } from '@nirvana/contracts';
import Fastify, {
  LogController,
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  serializerCompiler,
  validatorCompiler,
  type FastifyPluginAsyncZod,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import type { Config } from './config';
import type { Logger } from './logger';
import type { Readiness } from './readiness';
import { useFrenchValidationMessages } from './validation-messages';

export interface ServerDeps {
  readonly config: Config;
  readonly logger: Logger;
  /** Every module's routes, mounted under `/v1` (api.md). */
  readonly routes: readonly FastifyPluginAsyncZod[];
  readonly readiness: () => Promise<Readiness>;
  /** Shared counters (ADR 0027); without it, each process counts in its own memory (tests). */
  readonly rateLimitStore?: FastifyRateLimitStoreCtor;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** `false` exempts a route from the dashboard's Origin check: it authenticates otherwise (device token). */
    originCheck?: boolean;
  }
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const BODY_LIMIT_BYTES = 1_048_576;
const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Every method CORS lets the dashboard send (security.md §6); `OPTIONS` is the preflight itself. */
const CORS_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** A route's path as a pattern: a `:param` segment takes any one segment, a `*` the rest of the path. */
function pathPattern(url: string): RegExp {
  const segments = url.split('/').map((segment) => {
    if (segment === '*') return '.*';
    if (segment.includes(':')) return '[^/]+';
    return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  return new RegExp(`^${segments.join('/')}$`);
}

/** Reuses the caller's `x-request-id` when it is sane (it ends up in logs), otherwise a fresh one. */
function requestIdFor(request: { headers: Record<string, string | string[] | undefined> }): string {
  const header = request.headers['x-request-id'];
  return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
}

/** api.md § Erreurs: the status follows the code's suffix. */
export function statusForCode(code: string): number {
  if (code.endsWith('_not_found')) return 404;
  if (code.endsWith('_invalid')) return 400;
  if (code.endsWith('_unauthenticated')) return 401;
  if (code.endsWith('_forbidden')) return 403;
  if (code.endsWith('_conflict')) return 409;
  if (code.endsWith('_unprocessable')) return 422;
  if (code.endsWith('_limited')) return 429;
  return 500;
}

function errorBody(
  request: FastifyRequest,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ApiError {
  return { error: { code, message, details, requestId: request.id } };
}

export type Server = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  Logger,
  ZodTypeProvider
>;

/** Builds the HTTP server without listening, so tests can call it with `inject`. */
export async function buildServer(deps: ServerDeps): Promise<Server> {
  const { config } = deps;
  useFrenchValidationMessages();
  const server = Fastify({
    loggerInstance: deps.logger,
    genReqId: requestIdFor,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    bodyLimit: BODY_LIMIT_BYTES,
    // Behind a proxy every request comes from its address: past the declared hops, `request.ip` is the client's.
    trustProxy: (_address: string, hop: number) => hop < config.TRUST_PROXY_HOPS,
  }).withTypeProvider<ZodTypeProvider>();

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  server.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // CSRF (security.md §6): a mutation must come from the dashboard. `SameSite=Lax` cookies plus this check, no
  // separate token. A missing `Origin` is refused too: browsers always send it on a cross-site POST.
  const allowedOrigins = new Set([config.WEB_ORIGIN]);
  server.addHook('onRequest', async (request, reply) => {
    if (!MUTATIONS.has(request.method) || request.routeOptions.config.originCheck === false) return;
    const origin = request.headers.origin;
    if (origin === undefined || !allowedOrigins.has(origin)) {
      await reply.code(403).send(errorBody(request, 'origin_forbidden', 'Origine non autorisée'));
    }
  });

  await server.register(helmet);
  await server.register(cors, { origin: [config.WEB_ORIGIN], credentials: true, methods: CORS_METHODS });
  await server.register(rateLimit, {
    max: config.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    ...(deps.rateLimitStore === undefined ? {} : { store: deps.rateLimitStore }),
    // Fail-open (security.md): a Postgres down already stops most of the API, the limiter must not add to it. The
    // store logs each failure; sign-in fails closed on its own limiters (auth.ts).
    skipOnError: true,
    // The plugin throws a 429; the error handler below gives it the common body, `Retry-After` stays.
  });

  server.setErrorHandler((error: FastifyError, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      const fields = error.validation.map((issue) => ({
        path: issue.instancePath,
        message: issue.message ?? 'invalide',
      }));
      return reply.code(400).send(errorBody(request, 'request_invalid', 'Requête invalide', { fields }));
    }
    if (error instanceof DomainError) {
      const status = statusForCode(error.code);
      if (status === 500) {
        request.log.error({ err: error }, 'unmapped domain error');
        return reply.code(500).send(errorBody(request, 'internal_error', 'Erreur interne'));
      }
      return reply.code(status).send(errorBody(request, error.code, error.message, { ...error.details }));
    }
    if (error.statusCode === 429) {
      return reply
        .code(429)
        .send(errorBody(request, 'rate_limited', 'Trop de requêtes, réessaie dans un instant'));
    }
    if (error.statusCode === 503) {
      // A limiter that fails closed could not count (the store has logged why).
      return reply
        .code(503)
        .send(
          errorBody(
            request,
            'service_unavailable',
            'Service momentanément indisponible, réessaie dans un instant',
          ),
        );
    }
    if (error.statusCode === 413) {
      return reply
        .code(413)
        .send(errorBody(request, 'payload_too_large', 'Corps de requête trop volumineux'));
    }
    if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
      // Malformed JSON, unsupported media type and the like: the client's fault, nothing internal to hide.
      return reply.code(400).send(errorBody(request, 'request_invalid', 'Requête invalide'));
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody(request, 'internal_error', 'Erreur interne'));
  });

  // The methods each path answers, so a known path asked with another method gets 405 and `Allow`, not 404. The
  // preflight (`OPTIONS`, a wildcard route of the CORS plugin) is left out: it would match every path.
  const routeMethods: { readonly pattern: RegExp; readonly methods: readonly string[] }[] = [];
  server.addHook('onRoute', (route) => {
    const methods = [route.method].flat().filter((method) => method !== 'OPTIONS');
    if (methods.length > 0) routeMethods.push({ pattern: pathPattern(route.url), methods });
  });
  server.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? request.url;
    const allowed = new Set(
      routeMethods.filter((route) => route.pattern.test(path)).flatMap((route) => route.methods),
    );
    if (allowed.size === 0) {
      return reply.code(404).send(errorBody(request, 'route_not_found', 'Route introuvable'));
    }
    if (allowed.has('GET')) allowed.add('HEAD');
    return reply
      .code(405)
      .header('allow', [...allowed].sort().join(', '))
      .send(errorBody(request, 'method_not_allowed', 'Méthode non prévue sur cette route'));
  });

  // Outside `/v1` (api.md): liveness and readiness, for Coolify and the uptime check.
  server.get('/health', { config: { rateLimit: false } }, () => ({ status: 'ok' }));
  server.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const readiness = await deps.readiness();
    return reply.code(readiness.isReady ? 200 : 503).send({
      status: readiness.isReady ? 'ready' : 'not_ready',
      checks: readiness.checks,
      deadJobs: readiness.deadJobs ?? null,
    });
  });

  // Route guards (`requireRole`, `recentLogin`, the sign-in limiter) are `preValidation` hooks: they run before the
  // schema, so an anonymous request gets 401 rather than a 400 listing the fields the route expects. A guard reads
  // the session, never the unvalidated input. A `preHandler` would run after validation: refused at startup so a
  // guard cannot slip back behind the schema.
  server.addHook('onRoute', (route) => {
    if (route.preHandler !== undefined) {
      throw new Error(
        `${route.method.toString()} ${route.url}: declare route guards as preValidation, not preHandler`,
      );
    }
  });

  await server.register(
    async (v1) => {
      for (const routes of deps.routes) await v1.register(routes);
    },
    { prefix: '/v1' },
  );

  return server;
}
