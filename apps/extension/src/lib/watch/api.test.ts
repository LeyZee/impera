import {
  CreatorIdSchema,
  InstagramPostCodeSchema,
  TREND_CAPTURE_VISION_UNAVAILABLE,
  TREND_WATCH_BUDGET_LIMITED,
  WatchSessionIdSchema,
} from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import { fetchMarkableCreators, sendCaptures, sendReadings, type Fetch } from './api';

const ORIGIN = 'http://localhost:5173';
// Shaped like a link (43 base64url characters), plainly not one.
const TOKEN = 'x'.repeat(43);
const SESSION = WatchSessionIdSchema.parse('5b0a3c52-6d0e-4a59-9f1e-2a7c1d0b8e11');
const CODE = InstagramPostCodeSchema.parse('Cx0abc12DEf');
const CREATOR = CreatorIdSchema.parse('0d4c7f5e-3b1a-4c8e-9a2d-6e5f4b3a2c10');

function answer(status: number, body: unknown): Fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
}

function errorBody(code: string): unknown {
  return { error: { code, message: 'x', details: {}, requestId: 'req-1' } };
}

const BATCH = {
  watchSession: SESSION,
  readings: [
    {
      code: CODE,
      path: 'reel' as const,
      account: 'atelier.lune',
      metrics: { views: null, likes: 12, comments: null },
      caption: null,
      hashtags: [],
      sound: null,
      soundId: null,
      dwellMs: 1_000,
      markedFor: null,
      seenAt: '2026-11-06T14:00:00.000Z',
    },
  ],
};

describe('sendReadings', () => {
  it('sends the batch with the link, never the CRM’s cookie', async () => {
    const fetchFn = answer(200, { accepted: 1 });
    expect(await sendReadings(ORIGIN, TOKEN, BATCH, fetchFn)).toEqual({ kind: 'ok', value: 1 });
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/v1/trends/readings`);
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('x-extension-link')).toBe(TOKEN);
  });

  it('tells a removed link, a refused batch and an outage apart', async () => {
    expect(await sendReadings(ORIGIN, TOKEN, BATCH, answer(401, errorBody('x')))).toEqual({
      kind: 'revoked',
    });
    expect(await sendReadings(ORIGIN, TOKEN, BATCH, answer(400, errorBody('validation_failed')))).toEqual({
      kind: 'refused',
      code: 'validation_failed',
    });
    expect(await sendReadings(ORIGIN, TOKEN, BATCH, answer(503, {}))).toEqual({ kind: 'unreachable' });
    const down: Fetch = () => Promise.reject(new TypeError('offline'));
    expect(await sendReadings(ORIGIN, TOKEN, BATCH, down)).toEqual({ kind: 'unreachable' });
  });

  it('sends nothing with a malformed link', async () => {
    const fetchFn = answer(200, { accepted: 1 });
    expect(await sendReadings(ORIGIN, 'pas-un-code', BATCH, fetchFn)).toEqual({ kind: 'revoked' });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('fetchMarkableCreators', () => {
  it('reads the creators the person may mark for', async () => {
    const items = [{ id: CREATOR, displayName: 'Créatrice A' }];
    expect(await fetchMarkableCreators(ORIGIN, TOKEN, answer(200, { items }))).toEqual({
      kind: 'ok',
      value: { items },
    });
  });
});

describe('sendCaptures', () => {
  const body = {
    watchSession: SESSION,
    code: CODE,
    durationS: 14.2,
    captures: [{ mediaType: 'image/jpeg' as const, data: btoa('capture') }],
  };
  const description = { hook: 'x', angles: [], onScreenText: null, editing: 'y' };

  it('says what the vision answered', async () => {
    expect(await sendCaptures(ORIGIN, TOKEN, body, answer(200, { description }))).toBe('described');
    expect(await sendCaptures(ORIGIN, TOKEN, body, answer(429, errorBody(TREND_WATCH_BUDGET_LIMITED)))).toBe(
      'budget',
    );
    expect(
      await sendCaptures(ORIGIN, TOKEN, body, answer(503, errorBody(TREND_CAPTURE_VISION_UNAVAILABLE))),
    ).toBe('unavailable');
    expect(
      await sendCaptures(ORIGIN, TOKEN, body, answer(404, errorBody('trend_capture_reading_not_found'))),
    ).toBe('failed');
    expect(await sendCaptures(ORIGIN, TOKEN, body, answer(401, errorBody('x')))).toBe('revoked');
  });
});
