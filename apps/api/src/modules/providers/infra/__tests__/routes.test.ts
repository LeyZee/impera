import type { preValidationAsyncHookHandler } from 'fastify';
import { describe, expect, it } from 'vitest';

import { createMemoryCredentialStore, createProvidersModule } from '../..';
import { testConfig } from '../../../../__tests__/support/config';
import { createLogger } from '../../../../logger';
import { buildServer } from '../../../../server';
import type { FetchLike } from '../http';

const XAI_KEY = 'xai-FAKEFAKEFAKEFAKEFAKEFAKE0000';
const MISTRAL_KEY = 'FAKEmistralFAKEmistralFAKEmistral0';

/** xAI accepts XAI_KEY and nothing else. */
const fakeXai: FetchLike = (_url, init) => {
  const status = init.headers['authorization'] === `Bearer ${XAI_KEY}` ? 200 : 401;
  return Promise.resolve({ status, text: () => Promise.resolve(JSON.stringify({ name: 'nirvana' })) });
};

/** Stands in for `requireRole('owner')` (auth.ts): the header says who asks. */
const ownerOnly: preValidationAsyncHookHandler = async (request, reply) => {
  if (request.headers['x-test-role'] !== 'owner') await reply.code(403).send({ error: 'forbidden' });
};

/** Stands in for `requireRecentLogin` (auth.ts): the header says the sign-in is old. */
const freshOnly: preValidationAsyncHookHandler = async (request, reply) => {
  if (request.headers['x-test-stale'] === '1')
    await reply.code(403).send({ error: { code: 'reauthentication_forbidden' } });
};

/** Every line the server logs, for the tests that check no key ever reaches them. */
function capturedLogs() {
  const lines: string[] = [];
  return { lines, destination: { write: (line: string) => void lines.push(line) } };
}

async function server(logs = capturedLogs()) {
  const providers = createProvidersModule({
    store: createMemoryCredentialStore(),
    fetch: fakeXai,
    environmentKeys: null,
  });
  const config = testConfig();
  const app = await buildServer({
    config,
    logger: createLogger({ LOG_LEVEL: 'trace' }, logs.destination),
    routes: [providers.routes({ guard: ownerOnly, recentLogin: freshOnly })],
    readiness: () =>
      Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
  });
  const headers = { 'x-test-role': 'owner', origin: config.WEB_ORIGIN };
  return { app, headers, providers, logs: logs.lines };
}

describe('/v1/settings/providers', () => {
  it('is closed to anyone but the owner', async () => {
    const { app } = await server();
    const response = await app.inject({ method: 'GET', url: '/v1/settings/providers' });
    expect(response.statusCode).toBe(403);
  });

  it('asks for a recent sign-in to connect or remove a key, not to read', async () => {
    const { app, headers } = await server();
    const stale = { ...headers, 'x-test-stale': '1' };
    const put = await app.inject({
      method: 'PUT',
      url: '/v1/settings/providers/xai/key',
      headers: stale,
      payload: { key: XAI_KEY },
    });
    expect(put.statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: '/v1/settings/providers/xai', headers: stale })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: '/v1/settings/providers', headers: stale })).statusCode,
    ).toBe(200);
  });

  it('lists the four services, Grok first, and says what to do next', async () => {
    const { app, headers } = await server();
    const response = await app.inject({ method: 'GET', url: '/v1/settings/providers', headers });
    expect(response.statusCode).toBe(200);
    const body: unknown = response.json();
    expect(body).toMatchObject({
      services: [
        { provider: 'xai' },
        { provider: 'google' },
        { provider: 'mistral' },
        { provider: 'elevenlabs' },
      ],
      next: { kind: 'connect', provider: 'xai' },
    });
  });

  it('connects a good key without ever sending it back', async () => {
    const { app, headers, providers } = await server();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/providers/xai/key',
      headers,
      payload: { key: `  ${XAI_KEY}  ` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ provider: 'xai', state: 'connected', keyLabel: 'nirvana' });
    expect(response.body).not.toContain(XAI_KEY);
    expect(providers.apiKeySource('xai')).toBe(XAI_KEY);
  });

  it('answers a refused key with the French reason, and keeps nothing', async () => {
    const { app, headers, providers } = await server();
    const response = await app.inject({
      method: 'PUT',
      url: '/v1/settings/providers/xai/key',
      headers,
      payload: { key: 'xai-WRONGWRONGWRONGWRONGWRONG00' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ kind: 'unauthorized' });
    expect(providers.apiKeySource('xai')).toBeUndefined();
  });

  it('answers an obvious mistake before asking for the password, never before the owner check', async () => {
    const { app, headers } = await server();
    const url = '/v1/settings/providers/xai/key';
    const stale = { ...headers, 'x-test-stale': '1' };
    const short = await app.inject({ method: 'PUT', url, headers: stale, payload: { key: 'court' } });
    expect(short.statusCode).toBe(422);
    expect(short.json()).toMatchObject({ kind: 'too_short' });
    const misplaced = await app.inject({
      method: 'PUT',
      url: '/v1/settings/providers/mistral/key',
      headers: stale,
      payload: { key: 'sk_FAKEFAKEFAKEFAKEFAKEFAKE0000' },
    });
    expect(misplaced.json()).toEqual({
      kind: 'wrong_provider',
      message: 'Cette clé vient d’ElevenLabs : elle va dans ElevenLabs.',
    });
    // A key that could be right still asks for the password first.
    const plausible = await app.inject({ method: 'PUT', url, headers: stale, payload: { key: XAI_KEY } });
    expect(plausible.statusCode).toBe(403);
    expect(plausible.body).toContain('reauthentication_forbidden');
    const stranger = await app.inject({
      method: 'PUT',
      url,
      headers: { origin: headers.origin },
      payload: { key: 'court' },
    });
    expect(stranger.statusCode).toBe(403);
    expect(stranger.body).not.toContain('too_short');
  });

  it('refuses settings for a service without a key, and an unknown service', async () => {
    const { app, headers } = await server();
    const settings = await app.inject({
      method: 'PUT',
      url: '/v1/settings/providers/google/settings',
      headers,
      payload: { visionModel: 'gemini-3.8-flash' },
    });
    expect(settings.statusCode).toBe(404);
    const unknown = await app.inject({
      method: 'POST',
      url: '/v1/settings/providers/openai/verify',
      headers,
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('disconnects a key', async () => {
    const { app, headers, providers } = await server();
    await providers.connect('xai', XAI_KEY);
    const response = await app.inject({ method: 'DELETE', url: '/v1/settings/providers/xai', headers });
    expect(response.json()).toMatchObject({ provider: 'xai', state: 'not_connected' });
    expect(providers.apiKeySource('xai')).toBeUndefined();
  });

  it('never writes a key in the logs, accepted, refused or rejected by validation', async () => {
    const { app, headers, logs } = await server();
    const wrong = 'xai-WRONGWRONGWRONGWRONGWRONG00';
    const put = (url: string, key: string) => app.inject({ method: 'PUT', url, headers, payload: { key } });
    await put('/v1/settings/providers/xai/key', XAI_KEY);
    await put('/v1/settings/providers/xai/key', wrong);
    await put('/v1/settings/providers/openai/key', XAI_KEY);
    await put('/v1/settings/providers/mistral/key', MISTRAL_KEY);
    await app.inject({
      method: 'PUT',
      url: '/v1/settings/providers/xai/key',
      headers,
      payload: { key: XAI_KEY, extra: XAI_KEY },
    });
    expect(logs.length).toBeGreaterThan(0);
    const written = logs.join('\n');
    expect(written).not.toContain(XAI_KEY);
    expect(written).not.toContain(wrong);
    expect(written).not.toContain(MISTRAL_KEY);
  });

  it('slows down repeated pastes and checks, which each call the provider', async () => {
    const { app, headers } = await server();
    const codes: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/settings/providers/xai/verify',
        headers,
      });
      codes.push(response.statusCode);
    }
    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
