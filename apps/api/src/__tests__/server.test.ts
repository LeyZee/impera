import { Writable } from 'node:stream';

import { DomainError } from '@nirvana/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadConfig } from '../config';
import { createLogger } from '../logger';
import type { Readiness } from '../readiness';
import { buildServer, statusForCode } from '../server';

import { testConfig } from './support/config';

const ORIGIN = { origin: 'http://localhost:5173' };

const READY: Readiness = {
  isReady: true,
  checks: { database: true, migrations: true, worker: true },
  deadJobs: 0,
};

class ConversationNotFound extends DomainError {}
class DraftConflict extends DomainError {}

/** Routes that exercise the central error handler. */
const probeRoutes: FastifyPluginAsyncZod = (app) => {
  app.post(
    '/probe',
    { schema: { body: z.object({ name: z.string().min(1), count: z.number().int() }) } },
    (request) => ({ hello: request.body.name }),
  );
  app.post(
    '/probe-own-message',
    {
      schema: {
        body: z.object({ day: z.number().refine((day) => day === 1 || day === 16, 'Un 1er ou un 16') }),
      },
    },
    () => ({}),
  );
  app.get('/missing', () => {
    throw new ConversationNotFound('conversation_not_found', 'Conversation introuvable');
  });
  app.get('/conflict', () => {
    throw new DraftConflict('draft_conflict', 'Brouillon déjà envoyé');
  });
  app.get('/boom', () => {
    throw new Error('select * from secrets where leaked = true');
  });
  return Promise.resolve();
};

async function server(
  options: { readiness?: Readiness; env?: NodeJS.ProcessEnv } = {},
): ReturnType<typeof buildServer> {
  const config = testConfig(options.env);
  return buildServer({
    config,
    logger: createLogger(config),
    routes: [probeRoutes],
    readiness: () => Promise.resolve(options.readiness ?? READY),
  });
}

describe('health and readiness', () => {
  it('answers /health outside /v1', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });

  it('answers /ready 200 when every check passes and 503 otherwise, with the checks', async () => {
    const ready = await (await server()).inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ready', checks: READY.checks, deadJobs: 0 });

    const down: Readiness = {
      isReady: false,
      checks: { database: true, migrations: true, worker: false },
      deadJobs: null,
    };
    const notReady = await (await server({ readiness: down })).inject({ method: 'GET', url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ status: 'not_ready', checks: down.checks, deadJobs: null });
  });
});

describe('request id', () => {
  it('echoes a sane x-request-id and replaces a dangerous one', async () => {
    const app = await server();
    const kept = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'req-123' } });
    expect(kept.headers['x-request-id']).toBe('req-123');

    const replaced = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'evil\nlog line' },
    });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error format (api.md)', () => {
  it('refuses an invalid body with 400 and the Zod field errors', async () => {
    const response = await (
      await server()
    ).inject({
      method: 'POST',
      url: '/v1/probe',
      payload: { name: '', count: 1.5 },
      headers: { ...ORIGIN, 'x-request-id': 'req-400' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{
      error: { code: string; requestId: string; details: { fields: unknown[] } };
    }>();
    expect(body.error.code).toBe('request_invalid');
    expect(body.error.requestId).toBe('req-400');
    // Zod's own messages in French, like the rest of the body (recette 28/10).
    expect(body.error.details.fields).toEqual(
      expect.arrayContaining([
        { path: '/name', message: 'Trop petit : chaîne de caractères doit avoir >=1 caractères' },
        { path: '/count', message: 'Entrée invalide : entier attendu, nombre reçu' },
      ]),
    );
  });

  it('keeps the French message a schema writes itself', async () => {
    const response = await (
      await server()
    ).inject({
      method: 'POST',
      url: '/v1/probe-own-message',
      payload: { day: 31 },
      headers: ORIGIN,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { details: { fields: unknown[] } } }>().error.details.fields).toEqual([
      { path: '/day', message: 'Un 1er ou un 16' },
    ]);
  });

  it('accepts a valid body under /v1', async () => {
    const response = await (
      await server()
    ).inject({
      method: 'POST',
      url: '/v1/probe',
      payload: { name: 'ok', count: 2 },
      headers: ORIGIN,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ hello: 'ok' });
  });

  it('refuses malformed JSON with 400', async () => {
    const response = await (
      await server()
    ).inject({
      method: 'POST',
      url: '/v1/probe',
      payload: '{"name":',
      headers: { ...ORIGIN, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('request_invalid');
  });

  it('maps domain errors by the suffix of their code', async () => {
    const app = await server();
    const missing = await app.inject({ method: 'GET', url: '/v1/missing' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'conversation_not_found',
      message: 'Conversation introuvable',
    });
    expect((await app.inject({ method: 'GET', url: '/v1/conflict' })).statusCode).toBe(409);
  });

  it('hides the detail of an unexpected error behind a 500', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/v1/boom' });
    expect(response.statusCode).toBe(500);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('internal_error');
    expect(response.body).not.toContain('secrets');
  });

  it('answers an unknown route with route_not_found', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('route_not_found');
  });

  it('answers a known path asked with another method with 405 and Allow', async () => {
    const app = await server();
    const deleted = await app.inject({ method: 'DELETE', url: '/v1/probe', headers: ORIGIN });
    expect(deleted.statusCode).toBe(405);
    expect(deleted.headers.allow).toBe('POST');
    expect(deleted.json<{ error: { code: string } }>().error.code).toBe('method_not_allowed');
    const posted = await app.inject({ method: 'POST', url: '/v1/missing?x=1', headers: ORIGIN });
    expect([posted.statusCode, posted.headers.allow]).toEqual([405, 'GET, HEAD']);
    // An unknown path stays a 404, whatever the method, preflight route or not.
    const unknown = await app.inject({ method: 'PATCH', url: '/v1/nothing-here', headers: ORIGIN });
    expect([unknown.statusCode, unknown.json<{ error: { code: string } }>().error.code]).toEqual([
      404,
      'route_not_found',
    ]);
  });

  it('maps the code suffixes to their status', () => {
    expect(statusForCode('fan_not_found')).toBe(404);
    expect(statusForCode('price_invalid')).toBe(400);
    expect(statusForCode('session_unauthenticated')).toBe(401);
    expect(statusForCode('takeover_forbidden')).toBe(403);
    expect(statusForCode('draft_conflict')).toBe(409);
    expect(statusForCode('send_limited')).toBe(429);
    expect(statusForCode('whatever')).toBe(500);
  });
});

describe('HTTP protections (security.md §6)', () => {
  it('refuses a mutation without Origin or from another origin, lets reads through', async () => {
    const app = await server();
    const post = (headers: Record<string, string>) =>
      app.inject({ method: 'POST', url: '/v1/probe', payload: { name: 'a', count: 1 }, headers });
    for (const response of [await post({}), await post({ origin: 'https://evil.example' })]) {
      expect(response.statusCode).toBe(403);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('origin_forbidden');
    }
    expect((await post(ORIGIN)).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('sends the helmet headers', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeDefined();
  });

  it('lets CORS through for the dashboard origin only', async () => {
    const app = await server();
    const preflight = (origin: string) =>
      app.inject({
        method: 'OPTIONS',
        url: '/v1/probe',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
    expect((await preflight('http://localhost:5173')).headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    // Every method the API uses, not only CORS's default GET, HEAD and POST.
    expect((await preflight('http://localhost:5173')).headers['access-control-allow-methods']).toBe(
      'GET, HEAD, POST, PUT, PATCH, DELETE',
    );
  });

  it('rate-limits per IP with the common error body', async () => {
    const app = await server({ env: { RATE_LIMIT_PER_MINUTE: '2' } });
    const call = () =>
      app.inject({ method: 'POST', url: '/v1/probe', payload: { name: 'a', count: 1 }, headers: ORIGIN });
    await call();
    await call();
    const limited = await call();
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
  });

  it('refuses a body over the size limit', async () => {
    const response = await (
      await server()
    ).inject({
      method: 'POST',
      url: '/v1/probe',
      payload: { name: 'x'.repeat(1_100_000), count: 1 },
      headers: ORIGIN,
    });
    expect(response.statusCode).toBe(413);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('payload_too_large');
  });
});

describe('logger', () => {
  it('redacts credentials and message content', () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ LOG_LEVEL: 'info' }, sink);
    logger.info({ message: { text: 'mon message intime' }, credentials: { apiKey: 'xai-123' } }, 'check');
    const output = lines.join('');
    expect(output).not.toContain('mon message intime');
    expect(output).not.toContain('xai-123');
    expect(output).toContain('[redacted]');
  });
});

describe('loadConfig', () => {
  it('rejects an invalid port', () => {
    expect(() => testConfig({ PORT: 'not-a-port' })).toThrow(/PORT/);
  });

  it('names every missing required variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*DATABASE_ADMIN_URL[\s\S]*WEB_ORIGIN/);
  });

  it('refuses the placeholder secret in production only', () => {
    const placeholder = { AUTH_SECRET: 'replace-with-openssl-rand-base64-32' };
    expect(testConfig(placeholder).AUTH_SECRET).toBe(placeholder.AUTH_SECRET);
    expect(() => testConfig({ ...placeholder, NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
  });

  it('takes an AI key left empty in .env as unset', () => {
    const config = testConfig({
      LLM_XAI_API_KEY: '',
      LLM_GOOGLE_API_KEY: '',
      LLM_MISTRAL_API_KEY: '',
      LLM_VENICE_API_KEY: '',
      SPEECH_ELEVENLABS_API_KEY: '',
    });
    expect(config.LLM_XAI_API_KEY).toBeUndefined();
    expect(config.LLM_MISTRAL_API_KEY).toBeUndefined();
    expect(config.LLM_VENICE_API_KEY).toBeUndefined();
    expect(config.SPEECH_ELEVENLABS_API_KEY).toBeUndefined();
  });

  it('reads the inline-worker flag', () => {
    expect(testConfig().NIRVANA_INLINE_WORKER).toBe(false);
    expect(testConfig({ NIRVANA_INLINE_WORKER: '1' }).NIRVANA_INLINE_WORKER).toBe(true);
    expect(() => testConfig({ NIRVANA_INLINE_WORKER: 'yes' })).toThrow(/NIRVANA_INLINE_WORKER/);
  });

  it('treats an empty playground path as unset, as copied from .env.example', () => {
    const config = testConfig({ PLAYGROUND_PERSONA_PATH: '', NIRVANA_TRAINING_DIR: '' });
    expect(config.PLAYGROUND_PERSONA_PATH).toBeUndefined();
    expect(config.NIRVANA_TRAINING_DIR).toBeUndefined();
  });
});

describe('route guards', () => {
  it('refuses at startup a route that guards in preHandler, after the schema', async () => {
    // Async so the refusal rejects the start; a plain plugin throws it out of `register` and stops the process.
    const late: FastifyPluginAsyncZod = async (app) => {
      await Promise.resolve();
      app.get('/late', { preHandler: () => Promise.resolve() }, () => ({ ok: true }));
    };
    const config = testConfig();
    await expect(
      buildServer({
        config,
        logger: createLogger(config),
        routes: [late],
        readiness: () => Promise.resolve(READY),
      }),
    ).rejects.toThrow(/declare route guards as preValidation/);
  });
});
