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
 * - Every recording in `recordings/<date>/` (a response cut out of an anonymised capture, reviewed before commit)
 *   passes the shape of the endpoint it names, on the same method, and that endpoint is marked observed on the
 *   recording's date.
 *
 * A recording that does not fit means the shape (and FakeReveal) must change in the same PR.
 */

const RecordingSchema = z.object({
  endpoint: EndpointNameSchema,
  /** Date of the capture the response comes from (YYYY-MM-DD). */
  capturedOn: z.iso.date(),
  /** As Reveal was called, identifiers hashed by scripts/anonymize-har.mjs. */
  request: z.object({ method: z.string(), path: z.string(), body: z.unknown().optional() }),
  response: z.object({ status: z.number().int(), body: z.unknown() }),
});

type Method = 'GET' | 'POST' | 'PATCH';

const SAMPLES: Record<EndpointName, { method: Method; url: string; body?: object }> = {
  'conversations.list': { method: 'GET', url: '/conversations/model?take=20&modelId=model_test&filter=all' },
  'conversations.count': {
    method: 'GET',
    url: '/conversations/model/count?modelId=model_test&isUnread=true',
  },
  'conversations.get': { method: 'GET', url: '/conversations/conv_02' },
  'messages.list': { method: 'GET', url: '/conversations/conv_02/messages?take=10' },
  'messages.send': {
    method: 'POST',
    url: '/conversations/conv_02/messages',
    body: { message: { content: 'x', isUnread: true }, mediaIds: [], files: [] },
  },
  'conversations.read': { method: 'PATCH', url: '/conversations/conv_02/read' },
  'conversations.typing': { method: 'POST', url: '/conversations/conv_02/typing' },
  'conversations.typing.get': { method: 'GET', url: '/conversations/conv_02/typing' },
  'conversations.note': { method: 'PATCH', url: '/conversations/conv_02/note', body: { note: 'x' } },
  'conversations.ppvHistory': { method: 'GET', url: '/conversations/conv_02/ppv-history?take=10&kind=paid' },
  'conversations.stats': { method: 'GET', url: '/conversations/conv_02/stats' },
  'models.get': { method: 'GET', url: '/models/model_test' },
  'scripts.list': { method: 'GET', url: '/scripts/model/model_test?take=20&withConversations=false' },
  'scriptSequences.list': { method: 'GET', url: '/script-sequences/model/model_test' },
  'vault.folders': { method: 'GET', url: '/models/model_test/vault-folders' },
  'vault.medias': { method: 'GET', url: '/models/model_test/medias?take=10&vaultFolderId=folder_1' },
  'transactions.list': { method: 'GET', url: '/transactions/model/model_test?take=10' },
  'notifications.list': { method: 'GET', url: '/users/user_bot/notifications?take=5' },
  'media.uploadUrl': { method: 'GET', url: '/medias/get-upload-url?name=a.mp3&type=audio&size=100' },
};

const RECORDINGS_DIR = join(import.meta.dirname, 'recordings');
const recordings = readdirSync(RECORDINGS_DIR, { recursive: true, encoding: 'utf8' })
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
      headers: { authorization: fake.authorization },
      ...(sample.body === undefined ? {} : { payload: sample.body }),
    });
    expect(response.statusCode).toBe(200);
    const body: unknown = endpoint === 'media.uploadUrl' ? response.body : response.json();
    const parsed = ENDPOINTS[endpoint].shape.safeParse(body);
    expect(parsed.error).toBeUndefined();
  });

  it('has a recording for every endpoint', () => {
    const recorded = new Set(recordings.map(({ recording }) => recording.endpoint));
    expect(Object.keys(ENDPOINTS).filter((name) => !recorded.has(EndpointNameSchema.parse(name)))).toEqual(
      [],
    );
  });

  it.each(recordings)('$file fits the shape of its endpoint', ({ recording }) => {
    expect(recording.request.method).toBe(ENDPOINTS[recording.endpoint].method);
    expect(recording.response.status).toBe(200);
    const parsed = ENDPOINTS[recording.endpoint].shape.safeParse(recording.response.body);
    expect(parsed.error).toBeUndefined();
    expect(OBSERVED_ON[recording.endpoint]).toBe(recording.capturedOn);
  });
});
