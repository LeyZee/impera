import { Writable } from 'node:stream';

import { DomainError } from '@impera/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { linkServiceOriginOf, loadConfig, mediaBucket } from '../config';
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
  // A route whose 422 is a refusal of one shape, throwing a 422 of another (recette 07/11, BIL-05).
  app.get(
    '/refusal-route',
    {
      schema: {
        response: {
          200: z.object({ ok: z.boolean() }),
          422: z.object({ error: z.object({ details: z.object({ kind: z.enum(['malformed']) }) }) }),
        },
      },
    },
    () => {
      throw new DomainError('webhook_url_unprocessable', 'L’adresse n’est pas en HTTPS');
    },
  );
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
  it('tells the dashboard it runs in the recette sandbox, and says nothing otherwise (ADR 0075)', async () => {
    const real = await (await server()).inject({ method: 'GET', url: '/health' });
    expect(real.headers['x-impera-sandbox']).toBeUndefined();
    const sandbox = await (
      await server({ env: { IMPERA_SANDBOX: '1' } })
    ).inject({ method: 'GET', url: '/health' });
    expect(sandbox.headers['x-impera-sandbox']).toBe('1');
  });

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

  it('refuses a JSON body nested past any contract with 400, never 500 (recette 07/11, BIL-03)', async () => {
    const app = await server();
    const nested = (depth: number) => `${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`;
    const deep = await app.inject({
      method: 'POST',
      url: '/v1/echo',
      payload: nested(20_000),
      headers: { ...ORIGIN, 'content-type': 'application/json' },
    });
    expect(deep.statusCode).toBe(400);
    expect(deep.json<{ error: { code: string } }>().error.code).toBe('request_invalid');
    // A body as deep as the limit still reaches its route (here, refused there for its fields, not here).
    const shallow = await app.inject({
      method: 'POST',
      url: '/v1/echo',
      payload: `{"text":"ok","x":${nested(62)}}`,
      headers: { ...ORIGIN, 'content-type': 'application/json' },
    });
    expect(shallow.statusCode).toBe(200);
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

  it('writes the common body even where the route declares another shape for that status (BIL-05)', async () => {
    const response = await (await server()).inject({ method: 'GET', url: '/v1/refusal-route' });
    expect(response.statusCode).toBe(422);
    expect(response.json<{ error: { code: string; message: string } }>().error).toMatchObject({
      code: 'webhook_url_unprocessable',
      message: 'L’adresse n’est pas en HTTPS',
    });
  });

  it('pins the keys of the common error body, now written without a response schema to filter it (BIL-05)', async () => {
    const app = await server();
    for (const url of ['/v1/refusal-route', '/v1/boom', '/v1/no-such-route']) {
      const body = (await app.inject({ method: 'GET', url })).json<{ error: Record<string, unknown> }>();
      expect(Object.keys(body), url).toEqual(['error']);
      expect(Object.keys(body.error).sort(), url).toEqual(['code', 'details', 'message', 'requestId']);
    }
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
    expect(statusForCode('invoice_pdf_gone')).toBe(410);
    expect(statusForCode('sales_feed_platform_bad_gateway')).toBe(502);
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

  it('counts the addresses of one IPv6 /64 as one client, another /64 apart (audit du 11/11)', async () => {
    const app = await server({ env: { RATE_LIMIT_PER_MINUTE: '2' } });
    const from = (remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/probe',
        payload: { name: 'a', count: 1 },
        headers: ORIGIN,
        remoteAddress,
      });
    await from('2001:db8:1:2::1');
    await from('2001:db8:1:2::2');
    expect((await from('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).statusCode).toBe(429);
    expect((await from('2001:db8:1:3::1')).statusCode).not.toBe(429);
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

  it('listens on this machine alone unless told otherwise (audit du 11/11)', () => {
    expect(testConfig({}).HOST).toBe('localhost');
    expect(testConfig({ HOST: '' }).HOST).toBe('localhost');
    expect(testConfig({ HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0');
  });

  it('stops on a variable still under the old name, and gives its new name', () => {
    const old = 'NIRVANA_INLINE_WORKER'; // ADR 0062
    expect(() => testConfig({ [old]: '1' })).toThrow(`${old} to IMPERA_INLINE_WORKER`);
    expect(testConfig({ IMPERA_INLINE_WORKER: '1' }).IMPERA_INLINE_WORKER).toBe(true);
  });

  it('names every missing required variable', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*DATABASE_SERVICE_URL[\s\S]*WEB_ORIGIN/);
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

  describe('the Sentry DSN (OPS-18)', () => {
    /** Production beside the DSN: the buckets and the keys it needs anyway. Invented, nothing here is reached. */
    const bucket = (prefix: string, endpoint: string): NodeJS.ProcessEnv => ({
      [`${prefix}ENDPOINT`]: endpoint,
      [`${prefix}REGION`]: 'eu-central',
      [`${prefix}BUCKET`]: `${prefix.toLowerCase()}bucket`,
      [`${prefix}ACCESS_KEY_ID`]: 'EXAMPLEKEYID',
      [`${prefix}SECRET_ACCESS_KEY`]: 'example-secret-for-tests-only',
    });
    const PRODUCTION: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      CREDENTIALS_ENCRYPTION_KEYS: 'k1:' + 'a'.repeat(44),
      SESSION_ENCRYPTION_KEYS: 'k1:' + 'b'.repeat(44),
      ...bucket('INVOICES_S3_', 'https://fsn1.objects.example.test'),
      ...bucket('INVOICES_COPY_S3_', 'https://s3.gra.copies.example.test'),
    };
    const DSN = 'https://publickey@errors.example.test/42';

    it('is optional outside production, empty counting as unset', () => {
      expect(testConfig().SENTRY_DSN).toBeUndefined();
      expect(testConfig({ SENTRY_DSN: '' }).SENTRY_DSN).toBeUndefined();
      expect(testConfig({ SENTRY_DSN: DSN }).SENTRY_DSN).toBe(DSN);
    });

    it('is required in production', () => {
      expect(() => testConfig(PRODUCTION)).toThrow(/SENTRY_DSN is required in production/u);
      expect(() => testConfig({ ...PRODUCTION, SENTRY_DSN: '' })).toThrow(/SENTRY_DSN is required/u);
      expect(testConfig({ ...PRODUCTION, SENTRY_DSN: DSN }).SENTRY_DSN).toBe(DSN);
    });

    it.each([
      ['http, not https', 'http://publickey@errors.example.test/42'],
      ['no key', 'https://errors.example.test/42'],
      ['no project', 'https://publickey@errors.example.test/'],
      ['a query', 'https://publickey@errors.example.test/42?debug=1'],
      ['a password', 'https://publickey:secret@errors.example.test/42'],
      ['not a URL', 'publickey@errors.example.test/42'],
    ])('refuses a DSN with %s', (_why, value) => {
      expect(() => testConfig({ SENTRY_DSN: value })).toThrow(/SENTRY_DSN must be an https Sentry DSN/u);
    });
  });

  describe('the origin of the redirect service (ADR 0120 § 3)', () => {
    it('is optional, empty counting as unset: the link connector is then off', () => {
      expect(testConfig().LINK_SERVICE_ORIGIN).toBeUndefined();
      expect(testConfig({ LINK_SERVICE_ORIGIN: '' }).LINK_SERVICE_ORIGIN).toBeUndefined();
      expect(testConfig({ LINK_SERVICE_ORIGIN: 'https://liens.example' }).LINK_SERVICE_ORIGIN).toBe(
        'https://liens.example',
      );
      expect(linkServiceOriginOf('https://api.liens.example')).toBe('https://api.liens.example');
    });

    it.each([
      ['http, not https', 'http://liens.example'],
      ['a port', 'https://liens.example:8443'],
      ['the default port written out', 'https://liens.example:443'],
      ['a path', 'https://liens.example/v1'],
      ['a trailing slash', 'https://liens.example/'],
      ['a query', 'https://liens.example?x=1'],
      ['credentials', 'https://user:secret@liens.example'],
      ['an IPv4 address', 'https://203.0.113.7'],
      ['an IPv6 address', 'https://[2001:db8::1]'],
      ['localhost', 'https://localhost'],
      ['a local name', 'https://liens.localhost'],
      ['an internal name', 'https://liens.internal'],
      ['a single label', 'https://liens'],
      ['capital letters', 'https://Liens.example'],
      ['a name outside ASCII', 'https://liéns.example'],
      ['an internationalised label', 'https://xn--lins-bpa.example'],
      ['no scheme', 'liens.example'],
    ])('refuses to start with %s, without echoing the value', (_why, value) => {
      expect(linkServiceOriginOf(value)).toBeNull();
      let message = '';
      try {
        testConfig({ LINK_SERVICE_ORIGIN: value });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/LINK_SERVICE_ORIGIN must be https:\/\/<domain>/u);
      expect(message).not.toContain(value);
    });
  });

  it('reads the inline-worker flag', () => {
    expect(testConfig().IMPERA_INLINE_WORKER).toBe(false);
    expect(testConfig({ IMPERA_INLINE_WORKER: '1' }).IMPERA_INLINE_WORKER).toBe(true);
    expect(() => testConfig({ IMPERA_INLINE_WORKER: 'yes' })).toThrow(/IMPERA_INLINE_WORKER/);
    // Empty, as `IMPERA_INLINE_WORKER=` in a .env: unset (BIL-02).
    expect(testConfig({ IMPERA_INLINE_WORKER: '' }).IMPERA_INLINE_WORKER).toBe(false);
  });

  it('sizes each database pool from its variable, the former sizes by default (ADR 0152 § 2)', () => {
    const defaults = testConfig();
    expect([
      defaults.DATABASE_POOL_MAX,
      defaults.DATABASE_SERVICE_POOL_MAX,
      defaults.RATE_LIMIT_POOL_MAX,
    ]).toEqual([10, 5, 3]);
    const sized = testConfig({
      DATABASE_POOL_MAX: '4',
      DATABASE_SERVICE_POOL_MAX: '3',
      RATE_LIMIT_POOL_MAX: '1',
    });
    expect([sized.DATABASE_POOL_MAX, sized.DATABASE_SERVICE_POOL_MAX, sized.RATE_LIMIT_POOL_MAX]).toEqual([
      4, 3, 1,
    ]);
    expect(() => testConfig({ DATABASE_POOL_MAX: '0' })).toThrow(/DATABASE_POOL_MAX/);
    expect(() => testConfig({ DATABASE_SERVICE_POOL_MAX: 'many' })).toThrow(/DATABASE_SERVICE_POOL_MAX/);
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
      SENTRY_DSN: 'https://publickey@errors.example.test/1',
    };

    it('refuses in production a remote base reached without a checked certificate (ADR 0152 § 2)', () => {
      const remote = (role: string, query: string) =>
        `postgres://${role}:test@pooler.db.example.test:5432/postgres${query}`;
      const verified = {
        DATABASE_URL: remote('nirvana_app', '?sslmode=verify-full'),
        DATABASE_SERVICE_URL: remote('impera_service', '?sslmode=verify-full'),
        DATABASE_ADMIN_URL: remote('nirvana_admin', '?sslmode=verify-full&sslrootcert=/run/ca.crt'),
      };
      expect(() => testConfig({ ...PRODUCTION, ...PRIMARY, ...COPY, ...verified })).not.toThrow();
      expect(() =>
        testConfig({
          ...PRODUCTION,
          ...PRIMARY,
          ...COPY,
          ...verified,
          DATABASE_SERVICE_URL: remote('impera_service', '?sslmode=require'),
        }),
      ).toThrow(/DATABASE_SERVICE_URL reaches a remote base: it must carry sslmode=verify-full, once/u);
      expect(() =>
        testConfig({
          ...PRODUCTION,
          ...PRIMARY,
          ...COPY,
          ...verified,
          DATABASE_ADMIN_URL: remote('nirvana_admin', ''),
        }),
      ).toThrow(/DATABASE_ADMIN_URL reaches a remote base/u);
      // Given twice, the library may keep the last value: refused even when the first one is right.
      expect(() =>
        testConfig({
          ...PRODUCTION,
          ...PRIMARY,
          ...COPY,
          ...verified,
          DATABASE_URL: remote('nirvana_app', '?sslmode=verify-full&sslmode=disable'),
        }),
      ).toThrow(/DATABASE_URL reaches a remote base/u);
      // A base on this machine, or behind a service name of the compose, is not on the network; nor is any outside
      // production.
      expect(() => testConfig({ ...PRODUCTION, ...PRIMARY, ...COPY })).not.toThrow();
      expect(() =>
        testConfig({
          ...PRODUCTION,
          ...PRIMARY,
          ...COPY,
          DATABASE_URL: 'postgres://nirvana_app:test@postgres:5432/impera',
        }),
      ).not.toThrow();
      expect(() => testConfig({ DATABASE_URL: remote('nirvana_app', '') })).not.toThrow();
    });

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
