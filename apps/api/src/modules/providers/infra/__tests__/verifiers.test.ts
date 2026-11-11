import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createElevenLabsVerifier } from '../elevenlabs.verifier';
import { createGoogleVerifier } from '../google.verifier';
import type { FetchLike } from '../http';
import { createMistralVerifier } from '../mistral.verifier';
import { createXaiVerifier } from '../xai.verifier';

/**
 * One fake server plays the three providers (fiche P3-03: « faux serveurs »). Each test sets the replies by path;
 * the bodies imitate the providers' documented shapes and are invented, never recorded from a real account.
 */
interface FakeReply {
  readonly status: number;
  readonly body: unknown;
}

let replies = new Map<string, FakeReply>();
let seenHeaders: IncomingHttpHeaders[] = [];
let server: Server;
let baseUrl = '';

const realFetch: FetchLike = (url, init) => fetch(url, init);
const unreachableFetch: FetchLike = () => Promise.reject(new Error('connect ECONNREFUSED'));

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHeaders.push(req.headers);
    const path = (req.url ?? '').split('?')[0] ?? '';
    const reply = replies.get(path) ?? { status: 404, body: { error: 'not found' } };
    res.writeHead(reply.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fake provider server has no port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

beforeEach(() => {
  replies = new Map();
  seenHeaders = [];
});

describe('xAI', () => {
  const verifier = () => createXaiVerifier({ fetch: realFetch, baseUrl });

  it('accepts a key with access to grok-4.7 and reads its name', async () => {
    replies.set('/v1/api-key', {
      status: 200,
      body: {
        name: 'impera-prod',
        acls: ['api-key:model:grok-4.7', 'api-key:endpoint:chat'],
        api_key_blocked: false,
      },
    });
    const outcome = await verifier().verify('xai-FAKE', {});
    expect(outcome).toMatchObject({
      ok: true,
      keyLabel: 'impera-prod',
      summary: 'Grok 4.7 écrit et décide',
    });
    expect(seenHeaders[0]?.authorization).toBe('Bearer xai-FAKE');
  });

  it('tells a missing model, a refused key, an empty account and an outage apart', async () => {
    replies.set('/v1/api-key', { status: 200, body: { name: 'k', acls: ['api-key:model:grok-4.3'] } });
    expect(await verifier().verify('xai-FAKE', {})).toEqual({ ok: false, kind: 'model_not_allowed' });

    replies.set('/v1/api-key', { status: 401, body: { error: 'Incorrect API key provided' } });
    expect(await verifier().verify('xai-FAKE', {})).toEqual({ ok: false, kind: 'unauthorized' });

    replies.set('/v1/api-key', { status: 403, body: { error: 'Your team does not have any credits yet' } });
    expect(await verifier().verify('xai-FAKE', {})).toEqual({ ok: false, kind: 'no_credit' });

    replies.set('/v1/api-key', { status: 503, body: 'upstream down' });
    const outage = { ok: false, kind: 'unreachable', reason: 'outage' };
    expect(await verifier().verify('xai-FAKE', {})).toEqual(outage);
    expect(await createXaiVerifier({ fetch: unreachableFetch, baseUrl }).verify('xai-FAKE', {})).toEqual(
      outage,
    );
    replies.set('/v1/api-key', { status: 200, body: 'not json' });
    expect(await verifier().verify('xai-FAKE', {})).toEqual(outage);
  });
});

describe('Google', () => {
  const verifier = () => createGoogleVerifier({ fetch: realFetch, baseUrl, compareWith: 'gemini-4-argon' });

  it('resolves the exact Vision model identifier and notices the model to compare', async () => {
    replies.set('/v1beta/models', {
      status: 200,
      body: {
        models: [
          { name: 'models/gemini-3.8-flash-preview-09-2026', displayName: 'Gemini 3.8 Flash' },
          { name: 'models/gemini-4-argon', displayName: 'Gemini 4 Argon' },
        ],
      },
    });
    const outcome = await verifier().verify('AIzaFAKE', {});
    expect(outcome).toMatchObject({
      ok: true,
      summary: 'Gemini 3.8 Flash regarde les médias',
      settings: { visionModel: 'gemini-3.8-flash-preview-09-2026' },
    });
    expect(outcome.ok && outcome.facts.map((f) => f.label)).toContain('Aussi visible');
    expect(seenHeaders[0]?.['x-goog-api-key']).toBe('AIzaFAKE');
  });

  it('lists what the key sees when the Vision model is missing', async () => {
    replies.set('/v1beta/models', { status: 200, body: { models: [{ name: 'models/gemini-3.5-flash' }] } });
    expect(await verifier().verify('AIzaFAKE', {})).toEqual({
      ok: false,
      kind: 'vision_model_missing',
      availableModels: ['gemini-3.5-flash'],
    });
  });

  it('reads an invalid key and a disabled API', async () => {
    replies.set('/v1beta/models', {
      status: 400,
      body: { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
    });
    expect(await verifier().verify('AIzaFAKE', {})).toEqual({ ok: false, kind: 'unauthorized' });
    replies.set('/v1beta/models', { status: 403, body: { error: { status: 'PERMISSION_DENIED' } } });
    expect(await verifier().verify('AIzaFAKE', {})).toEqual({ ok: false, kind: 'api_not_enabled' });
  });
});

describe('ElevenLabs', () => {
  const verifier = () => createElevenLabsVerifier({ fetch: realFetch, baseUrl });
  const voices = {
    voices: [
      { voice_id: 'v0', name: 'Rachel' },
      { voice_id: 'v1', name: 'Messa' },
    ],
  };

  it('picks the voice named after Messa and counts the voice notes left', async () => {
    replies.set('/v1/user/subscription', {
      status: 200,
      body: { character_count: 8_000, character_limit: 100_000 },
    });
    replies.set('/v1/voices', { status: 200, body: voices });
    const outcome = await verifier().verify('sk_FAKE', {});
    expect(outcome).toMatchObject({
      ok: true,
      settings: { voice: { id: 'v1', name: 'Messa' } },
      charactersLeft: 92_000,
      isLowCredit: false,
    });
    expect(outcome.ok && outcome.summary).toBe('Voix de Messa · 920 vocaux ce mois');
    expect(seenHeaders[0]?.['xi-api-key']).toBe('sk_FAKE');
  });

  it('flags low credit under 10 % and keeps a voice already picked', async () => {
    replies.set('/v1/user/subscription', {
      status: 200,
      body: { character_count: 96_000, character_limit: 100_000 },
    });
    replies.set('/v1/voices', { status: 200, body: voices });
    const outcome = await verifier().verify('sk_FAKE', { voice: { id: 'v0', name: 'Rachel' } });
    expect(outcome).toMatchObject({ ok: true, isLowCredit: true, settings: { voice: { id: 'v0' } } });
  });

  it('names the missing permission', async () => {
    replies.set('/v1/user/subscription', {
      status: 200,
      body: { character_count: 0, character_limit: 100_000 },
    });
    replies.set('/v1/voices', {
      status: 401,
      body: {
        detail: {
          status: 'missing_permissions',
          message: 'The API key you used is missing the permission voices_read to execute this operation.',
        },
      },
    });
    expect(await verifier().verify('sk_FAKE', {})).toEqual({
      ok: false,
      kind: 'missing_permission',
      permission: 'voices_read',
    });
  });

  it('reads an invalid key', async () => {
    replies.set('/v1/user/subscription', {
      status: 401,
      body: { detail: { status: 'invalid_api_key', message: 'Invalid API key' } },
    });
    expect(await verifier().verify('sk_FAKE', {})).toEqual({ ok: false, kind: 'unauthorized' });
  });
});

describe('Mistral', () => {
  const verifier = () => createMistralVerifier({ fetch: realFetch, baseUrl });

  it('accepts a key that sees Mistral Large, the writing fallback', async () => {
    replies.set('/v1/models', {
      status: 200,
      body: { object: 'list', data: [{ id: 'mistral-small-latest' }, { id: 'mistral-large-4-0' }] },
    });
    expect(await verifier().verify('FAKEmistralFAKEmistralFAKE00', {})).toMatchObject({
      ok: true,
      summary: 'Mistral Large prend le relais si Grok ne répond plus',
    });
    expect(seenHeaders[0]?.authorization).toBe('Bearer FAKEmistralFAKEmistralFAKE00');
  });

  it('tells a refused key, a missing model, an unpaid workspace and an outage apart', async () => {
    replies.set('/v1/models', { status: 401, body: { message: 'Unauthorized' } });
    expect(await verifier().verify('FAKE', {})).toEqual({ ok: false, kind: 'unauthorized' });
    replies.set('/v1/models', { status: 200, body: { data: [{ id: 'mistral-small-latest' }] } });
    expect(await verifier().verify('FAKE', {})).toEqual({ ok: false, kind: 'model_not_allowed' });
    // Another Mistral Large than the pinned one: the relay would be refused, so the key is not kept.
    replies.set('/v1/models', { status: 200, body: { data: [{ id: 'mistral-large-latest' }] } });
    expect(await verifier().verify('FAKE', {})).toEqual({ ok: false, kind: 'model_not_allowed' });
    replies.set('/v1/models', { status: 402, body: { message: 'Payment required' } });
    expect(await verifier().verify('FAKE', {})).toEqual({ ok: false, kind: 'no_credit' });
    replies.set('/v1/models', { status: 429, body: { message: 'Rate limit exceeded' } });
    expect(await verifier().verify('FAKE', {})).toEqual({
      ok: false,
      kind: 'unreachable',
      reason: 'rate_limited',
    });
    replies.set('/v1/models', { status: 502, body: 'Bad gateway' });
    expect(await verifier().verify('FAKE', {})).toEqual({ ok: false, kind: 'unreachable', reason: 'outage' });
  });
});

describe('a rate limit (429) says nothing about the key', () => {
  const tooMany = { status: 429, body: { error: 'Too many requests, slow down' } };

  it('reads as a rate limit at xAI, Google and ElevenLabs, never as a refused key or an empty account', async () => {
    replies.set('/v1/api-key', tooMany);
    replies.set('/v1beta/models', { status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } });
    replies.set('/v1/user/subscription', tooMany);
    const unreachable = { ok: false, kind: 'unreachable', reason: 'rate_limited' };
    expect(await createXaiVerifier({ fetch: realFetch, baseUrl }).verify('xai-FAKE', {})).toEqual(
      unreachable,
    );
    expect(await createGoogleVerifier({ fetch: realFetch, baseUrl }).verify('AIzaFAKE', {})).toEqual(
      unreachable,
    );
    expect(await createElevenLabsVerifier({ fetch: realFetch, baseUrl }).verify('sk_FAKE', {})).toEqual(
      unreachable,
    );
  });

  it('even mentioning credits in the body', async () => {
    replies.set('/v1/api-key', { status: 429, body: { error: 'Rate limit for your credits tier' } });
    expect(await createXaiVerifier({ fetch: realFetch, baseUrl }).verify('xai-FAKE', {})).toEqual({
      ok: false,
      kind: 'unreachable',
      reason: 'rate_limited',
    });
  });

  it('is told apart from an outage at ElevenLabs, on either call', async () => {
    replies.set('/v1/user/subscription', { status: 200, body: { character_count: 0, character_limit: 10 } });
    replies.set('/v1/voices', { status: 500, body: 'oops' });
    expect(await createElevenLabsVerifier({ fetch: realFetch, baseUrl }).verify('sk_FAKE', {})).toEqual({
      ok: false,
      kind: 'unreachable',
      reason: 'outage',
    });
    replies.set('/v1/voices', tooMany);
    expect(await createElevenLabsVerifier({ fetch: realFetch, baseUrl }).verify('sk_FAKE', {})).toEqual({
      ok: false,
      kind: 'unreachable',
      reason: 'rate_limited',
    });
  });
});
