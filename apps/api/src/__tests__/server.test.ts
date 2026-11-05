import { Writable } from 'node:stream';

import { DomainError } from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadConfig, mediaBucket } from '../config';
import { createLogger } from '../logger';
import type { Readiness } from '../readiness';
import { buildServer, statusForCode } from '../server';

import { testConfig } from './support/config';

const ORIGIN = { origin: 'http://localhost:5173' };

const READY: Readiness = {
  isReady: true,
  checks: { database: true, migrations: true, worker: true },
  deadJobs: 0,
  orphanedJobs: 0,
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
  app.post('/echo', { schema: { body: z.object({ text: z.string() }) } }, (request) => ({
    text: request.body.text,
  }));
  app.get('/item/:id', { schema: { params: z.object({ id: z.string() }) } }, (request) => ({
    id: request.params.id,
  }));
  app.get('/db-down', () => {
    throw new Error('Failed query: select 1\nparams: ', {
      cause: Object.assign(new Error('terminating connection due to administrator command'), {
        code: '57P01',
      }),
    });
  });
  app.get('/db-missing-ref', () => {
    throw new Error('Failed query: insert into blind_tests\nparams: 1', {
      cause: Object.assign(new Error('violates foreign key constraint'), {
        code: '23503',
        detail: 'Key (creator_id)=(x) is not present in table "creators".',
      }),
    });
  });
  // A signed webhook reads its body as bytes, like the Reveal sales feed (relecture #538).
  void app.register((raw, _options, done) => {
    raw.removeContentTypeParser('application/json');
    raw.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, parsed) => {
      parsed(null, body);
    });
    raw.post('/raw', (request) => ({
      buffer: Buffer.isBuffer(request.body),
      hex: Buffer.isBuffer(request.body) ? request.body.toString('hex') : null,
    }));
    done();
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
    expect(ready.json()).toEqual({ status: 'ready', checks: READY.checks, deadJobs: 0, orphanedJobs: 0 });

    const down: Readiness = {
      isReady: false,
      checks: { database: true, migrations: true, worker: false },
      deadJobs: null,
    };
    const notReady = await (await server({ readiness: down })).inject({ method: 'GET', url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({
      status: 'not_ready',
      checks: down.checks,
      deadJobs: null,
      orphanedJobs: null,
    });
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

describe('hostile input (recette 05/11)', () => {
  it('drops U+0000 from a JSON body before validation (MOT-05)', async () => {
    const response = await (
      await server()
    ).inject({ method: 'POST', url: '/v1/echo', payload: { text: 'coucou\u0000toi' }, headers: ORIGIN });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ text: 'coucoutoi' });
  });

  it('leaves a raw body byte for byte, U+0000 included, for a signature to check', async () => {
    const payload = Buffer.from('{"t":"a\\u0000b"}\u0000', 'utf8');
    const response = await (
      await server()
    ).inject({
      method: 'POST',
      url: '/v1/raw',
      payload,
      headers: { ...ORIGIN, 'content-type': 'application/json' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ buffer: true, hex: payload.toString('hex') });
  });

  it('refuses U+0000 in the path or the query with the common body', async () => {
    const app = await server();
    for (const url of ['/v1/item/a%00b', '/v1/item/a?q=%00']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('request_invalid');
    }
  });

  it('answers a path parameter that is too long in the common body, in French (MOT-08)', async () => {
    const response = await (await server()).inject({ method: 'GET', url: `/v1/item/${'x'.repeat(5000)}` });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error).toMatchObject({ code: 'request_invalid', message: 'Requête invalide' });
    expect(response.body).not.toContain('xxxxxxxx');
  });

  it('answers 503 when the database cannot answer (MOT-07)', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/v1/db-down' });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('service_unavailable');
  });

  it('answers 404 when an id the client sent points at nothing (MOT-06)', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/v1/db-missing-ref' });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe('reference_not_found');
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
    // Zod's own messages in plain French, like the rest of the body (recette 28/10, recette 05/11 SEC-14).
    expect(body.error.details.fields).toEqual(
      expect.arrayContaining([
        { path: '/name', message: 'Ne peut pas être vide.' },
        { path: '/count', message: 'Un nombre entier est attendu, pas un nombre à virgule.' },
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
    expect(statusForCode('contractor_document_file_gone')).toBe(410);
    expect(statusForCode('send_limited')).toBe(429);
    expect(statusForCode('invoice_pdf_unavailable')).toBe(503);
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

  it('stops on a variable still under the old name, and gives its new name', () => {
    const old = 'NIRVANA_INLINE_WORKER'; // ADR 0062
    expect(() => testConfig({ [old]: '1' })).toThrow(`${old} to IMPERA_INLINE_WORKER`);
    expect(testConfig({ IMPERA_INLINE_WORKER: '1' }).IMPERA_INLINE_WORKER).toBe(true);
  });

  it('names every missing required variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*DATABASE_ADMIN_URL[\s\S]*WEB_ORIGIN/);
  });

  it('refuses the placeholder secret in production only', () => {
    const placeholder = { AUTH_SECRET: 'replace-with-openssl-rand-base64-32' };
    expect(testConfig(placeholder).AUTH_SECRET).toBe(placeholder.AUTH_SECRET);
    expect(() => testConfig({ ...placeholder, NODE_ENV: 'production' })).toThrow(/AUTH_SECRET/);
  });

  it('skips the breached-password check outside production only (recette MOT-14)', () => {
    expect(testConfig({}).PASSWORD_BREACH_CHECK).toBe('on');
    expect(testConfig({ PASSWORD_BREACH_CHECK: 'off' }).PASSWORD_BREACH_CHECK).toBe('off');
    expect(() => testConfig({ PASSWORD_BREACH_CHECK: 'off', NODE_ENV: 'production' })).toThrow(
      /PASSWORD_BREACH_CHECK/,
    );
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
    expect(testConfig().IMPERA_INLINE_WORKER).toBe(false);
    expect(testConfig({ IMPERA_INLINE_WORKER: '1' }).IMPERA_INLINE_WORKER).toBe(true);
    expect(() => testConfig({ IMPERA_INLINE_WORKER: 'yes' })).toThrow(/IMPERA_INLINE_WORKER/);
  });

  describe('the invoices’ buckets (ADR 0037)', () => {
    /** A whole bucket, invented (ADR 0010): nothing here reaches a provider. */
    const bucket = (prefix: string, endpoint: string, name: string): NodeJS.ProcessEnv => ({
      [`${prefix}ENDPOINT`]: endpoint,
      [`${prefix}REGION`]: 'eu-central',
      [`${prefix}BUCKET`]: name,
      [`${prefix}ACCESS_KEY_ID`]: 'EXAMPLEKEYID',
      [`${prefix}SECRET_ACCESS_KEY`]: 'example-secret-for-tests-only',
    });
    const PRIMARY = bucket('INVOICES_S3_', 'https://fsn1.objects.example.test', 'factures');
    const COPY = bucket('INVOICES_COPY_S3_', 'https://s3.gra.copies.example.test', 'factures-copie');
    /** What production needs beside the buckets. */
    const PRODUCTION: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      CREDENTIALS_ENCRYPTION_KEYS: 'k1:' + 'a'.repeat(44),
      SESSION_ENCRYPTION_KEYS: 'k1:' + 'b'.repeat(44),
      EXTENSION_DEVICE_TOKEN: 'c'.repeat(48),
    };

    it('takes both buckets whole, or none outside production, never half of one', () => {
      expect(() => testConfig({ ...PRIMARY, ...COPY })).not.toThrow();
      expect(() => testConfig()).not.toThrow();
      expect(() => testConfig({ INVOICES_S3_BUCKET: 'factures' })).toThrow(
        /INVOICES_S3_\* must all be set, or none/u,
      );
    });

    it('requires both in production, at an https endpoint each, at two providers', () => {
      expect(() => testConfig({ ...PRODUCTION, ...PRIMARY, ...COPY })).not.toThrow();
      expect(() => testConfig({ ...PRODUCTION, ...PRIMARY })).toThrow(
        /INVOICES_COPY_S3_\* must all be set in production/u,
      );
      expect(() =>
        testConfig({
          ...PRODUCTION,
          ...PRIMARY,
          ...COPY,
          INVOICES_S3_ENDPOINT: 'http://fsn1.objects.example.test',
        }),
      ).toThrow(/INVOICES_S3_ENDPOINT must be an https URL/u);
      expect(() =>
        testConfig({
          ...PRODUCTION,
          ...PRIMARY,
          ...COPY,
          INVOICES_COPY_S3_ENDPOINT: 'https://FSN1.objects.example.test/',
        }),
      ).toThrow(/the copy lives at another provider in production/u);
    });

    it('refuses an endpoint that is not a plain URL, and a copy in the first bucket', () => {
      for (const endpoint of [
        'fsn1.objects.example.test',
        'ftp://objects.example.test',
        'https://a:b@objects.example.test',
        'https://objects.example.test/?x=1',
      ]) {
        expect(() => testConfig({ ...PRIMARY, INVOICES_S3_ENDPOINT: endpoint }), endpoint).toThrow(
          /INVOICES_S3_ENDPOINT must be an http\(s\) URL/u,
        );
      }
      // A local MinIO in development: http, and two buckets on one host.
      expect(() =>
        testConfig({
          ...bucket('INVOICES_S3_', 'http://127.0.0.1:9000', 'factures'),
          ...bucket('INVOICES_COPY_S3_', 'http://127.0.0.1:9000/', 'factures-copie'),
        }),
      ).not.toThrow();
      expect(() =>
        testConfig({
          ...bucket('INVOICES_S3_', 'http://127.0.0.1:9000', 'factures'),
          ...bucket('INVOICES_COPY_S3_', 'http://127.0.0.1:9000/', 'Factures'),
        }),
      ).toThrow(/names the bucket of INVOICES_S3_\*/u);
    });
  });

  describe('the media bucket (CR-06 b)', () => {
    const MEDIA: NodeJS.ProcessEnv = {
      S3_ENDPOINT: 'https://fsn1.objects.example.test',
      S3_REGION: 'fsn1',
      S3_BUCKET: 'medias',
      S3_ACCESS_KEY_ID: 'EXAMPLEKEYID',
      S3_SECRET_ACCESS_KEY: 'example-secret-for-tests-only',
    };

    it('takes it whole or not at all; its name alone, as `.env.example` gives it, counts for none', () => {
      expect(mediaBucket(testConfig(MEDIA))).toEqual({
        endpoint: 'https://fsn1.objects.example.test',
        region: 'fsn1',
        bucket: 'medias',
        accessKeyId: 'EXAMPLEKEYID',
        secretAccessKey: 'example-secret-for-tests-only',
      });
      expect(mediaBucket(testConfig({ S3_BUCKET: 'impera-media', S3_ENDPOINT: '' }))).toBeNull();
      expect(() => testConfig({ ...MEDIA, S3_REGION: '' })).toThrow(/S3_\* must all be set, or none/u);
      expect(() => testConfig({ S3_ENDPOINT: MEDIA['S3_ENDPOINT'] })).toThrow(/S3_\* must all be set/u);
    });

    it('wants a plain URL, https in production', () => {
      expect(() => testConfig({ ...MEDIA, S3_ENDPOINT: 'http://127.0.0.1:9000' })).not.toThrow();
      expect(() => testConfig({ ...MEDIA, S3_ENDPOINT: 'objects.example.test' })).toThrow(
        /S3_ENDPOINT must be an http\(s\) URL/u,
      );
      expect(() =>
        testConfig({
          NODE_ENV: 'production',
          CREDENTIALS_ENCRYPTION_KEYS: 'k1:' + 'a'.repeat(44),
          SESSION_ENCRYPTION_KEYS: 'k1:' + 'b'.repeat(44),
          EXTENSION_DEVICE_TOKEN: 'c'.repeat(48),
          ...MEDIA,
          S3_ENDPOINT: 'http://fsn1.objects.example.test',
        }),
      ).toThrow(/S3_ENDPOINT must be an https URL/u);
    });
  });

  it('treats an empty playground path as unset, as copied from .env.example', () => {
    const config = testConfig({ PLAYGROUND_PERSONA_PATH: '', IMPERA_TRAINING_DIR: '' });
    expect(config.PLAYGROUND_PERSONA_PATH).toBeUndefined();
    expect(config.IMPERA_TRAINING_DIR).toBeUndefined();
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
