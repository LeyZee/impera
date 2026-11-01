import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ENDPOINTS, EndpointNameSchema, OBSERVED_ON, type EndpointName } from './model';
import { createFakeReveal } from './server';

/**
 * Fidelity (fake-reveal.md § Fidélité): FakeReveal must answer every endpoint with the shape Reveal really sends.
 *
 * - Every endpoint has a sample request, and FakeReveal's answer to it passes the endpoint's shape.
 * - Every recording in `recordings/` (a response cut out of an anonymised capture, reviewed before commit) passes
 *   the shape of the endpoint it names, and that endpoint is marked observed on the recording's date.
 *
 * Until the capture, `recordings/` holds no JSON and every shape is provisional; the second part then has nothing
 * to check. A recording that does not fit means the shape (and FakeReveal) must change in the same PR.
 */

const RecordingSchema = z.object({
  endpoint: EndpointNameSchema,
  /** Date of the capture the response comes from (YYYY-MM-DD). */
  capturedOn: z.iso.date(),
  /** As Reveal called it, identifiers hashed by scripts/anonymize-har.mjs. */
  request: z.object({ method: z.string(), path: z.string() }),
  response: z.object({ status: z.number().int(), body: z.unknown() }),
});

const SAMPLES: Record<EndpointName, { method: 'GET' | 'POST' | 'PUT'; url: string; body?: object }> = {
  'session.me': { method: 'GET', url: '/api/me' },
  'conversations.list': { method: 'GET', url: '/api/conversations' },
  'messages.list': { method: 'GET', url: '/api/conversations/conv_02/messages' },
  'messages.send': {
    method: 'POST',
    url: '/api/conversations/conv_02/messages',
    body: { text: 'x', nonce: 'f-1' },
  },
  'bundles.send': {
    method: 'POST',
    url: '/api/conversations/conv_02/bundles',
    body: { text: 'x', mediaIds: ['media_01'], priceCents: 500, nonce: 'f-2' },
  },
  'conversations.read': { method: 'POST', url: '/api/conversations/conv_02/read' },
  'fans.get': { method: 'GET', url: '/api/fans/fan_02' },
  'fans.note.get': { method: 'GET', url: '/api/fans/fan_02/note' },
  'fans.note.put': { method: 'PUT', url: '/api/fans/fan_02/note', body: { text: 'x' } },
  'fans.ppvStats': { method: 'GET', url: '/api/fans/fan_02/ppv-stats' },
  'fans.scriptHistory': { method: 'GET', url: '/api/fans/fan_02/script-history' },
  'creatorNote.get': { method: 'GET', url: '/api/creator-note' },
  'scripts.list': { method: 'GET', url: '/api/scripts' },
  'scripts.sendStep': {
    method: 'POST',
    url: '/api/conversations/conv_04/script-steps',
    body: { scriptId: 'script_4', stepIndex: 0, nonce: 'f-3' },
  },
  'transactions.list': { method: 'GET', url: '/api/transactions' },
  'vault.list': { method: 'GET', url: '/api/vault' },
  'media.link': { method: 'GET', url: '/api/media/media_01/link' },
};

const RECORDINGS_DIR = join(import.meta.dirname, 'recordings');
const recordings = readdirSync(RECORDINGS_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({
    file,
    recording: RecordingSchema.parse(JSON.parse(readFileSync(join(RECORDINGS_DIR, file), 'utf8'))),
  }));

const fake = createFakeReveal();
afterAll(() => fake.app.close());

describe('FakeReveal fidelity', () => {
  it.each(Object.entries(SAMPLES))('answers %s with its declared shape', async (name, sample) => {
    const endpoint = EndpointNameSchema.parse(name);
    expect(ENDPOINTS[endpoint].method).toBe(sample.method);
    const response = await fake.app.inject({
      method: sample.method,
      url: sample.url,
      headers: { cookie: fake.sessionCookie },
      ...(sample.body === undefined ? {} : { payload: sample.body }),
    });
    expect(response.statusCode).toBe(200);
    const parsed = ENDPOINTS[endpoint].shape.safeParse(response.json());
    expect(parsed.error).toBeUndefined();
  });

  it.runIf(recordings.length > 0).each(recordings)(
    '$file fits the shape of its endpoint',
    ({ recording }) => {
      const parsed = ENDPOINTS[recording.endpoint].shape.safeParse(recording.response.body);
      expect(parsed.error).toBeUndefined();
      expect(OBSERVED_ON[recording.endpoint]).toBe(recording.capturedOn);
    },
  );
});
