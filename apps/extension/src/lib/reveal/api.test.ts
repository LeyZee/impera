import {
  CONNECTOR_LINK_FORBIDDEN,
  CONNECTOR_SESSION_CONFLICT,
  CONNECTOR_SESSION_UNPROCESSABLE,
  PlatformAccountIdSchema,
} from '@impera/contracts';
import { describe, expect, it, vi } from 'vitest';

import type { Fetch } from '../watch/api';

import { fetchSyncableAccounts, sendSession } from './api';
import type { RevealSession } from './capture';

const ORIGIN = 'http://localhost:5173';
// Shaped like a link (43 base64url characters), plainly not one.
const TOKEN = 'x'.repeat(43);
const ACCOUNT = PlatformAccountIdSchema.parse('7c1e2b3a-4d5f-4a6b-8c7d-9e0f1a2b3c4d');
// Invented values (ADR 0010).
const SESSION: RevealSession = {
  v: 1,
  bearer: 'invented-bearer-0123456789abcdef',
  userId: 'member-b2',
  modelId: 'model-a1',
  userAgent: 'Mozilla/5.0 test',
  capturedAt: '2026-11-11T15:00:00.000Z',
};

function answer(status: number, body: unknown): Fetch {
  return vi.fn(() => Promise.resolve(new Response(status === 204 ? null : JSON.stringify(body), { status })));
}

function errorBody(code: string): unknown {
  return { error: { code, message: 'x', details: {}, requestId: 'req-1' } };
}

describe('sendSession', () => {
  it('sends the session of the specification with the link, never the CRM’s cookie', async () => {
    const fetchFn = answer(204, null);
    expect(await sendSession(ORIGIN, TOKEN, ACCOUNT, SESSION, fetchFn)).toBe('synced');
    const [url, init] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/v1/connector/sessions`);
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).get('x-extension-link')).toBe(TOKEN);
    const raw = typeof init?.body === 'string' ? init.body : '';
    const body: unknown = JSON.parse(raw);
    expect(body).toEqual({ platformAccountId: ACCOUNT, session: JSON.stringify(SESSION) });
    const session: unknown = JSON.parse(JSON.stringify(SESSION));
    expect(Object.keys(session ?? {}).sort()).toEqual([
      'bearer',
      'capturedAt',
      'modelId',
      'userAgent',
      'userId',
      'v',
    ]);
  });

  it('tells a removed link, a chatter’s link, another model and an outage apart', async () => {
    expect(await sendSession(ORIGIN, TOKEN, ACCOUNT, SESSION, answer(401, errorBody('x')))).toBe('revoked');
    expect(
      await sendSession(ORIGIN, TOKEN, ACCOUNT, SESSION, answer(403, errorBody(CONNECTOR_LINK_FORBIDDEN))),
    ).toBe('not-owner');
    expect(
      await sendSession(ORIGIN, TOKEN, ACCOUNT, SESSION, answer(409, errorBody(CONNECTOR_SESSION_CONFLICT))),
    ).toBe('other-model');
    expect(
      await sendSession(
        ORIGIN,
        TOKEN,
        ACCOUNT,
        SESSION,
        answer(422, errorBody(CONNECTOR_SESSION_UNPROCESSABLE)),
      ),
    ).toBe('refused');
    expect(await sendSession(ORIGIN, TOKEN, ACCOUNT, SESSION, answer(503, errorBody('x')))).toBe(
      'unreachable',
    );
  });
});

describe('fetchSyncableAccounts', () => {
  it('reads the Reveal accounts with the link', async () => {
    const accounts = {
      accounts: [
        {
          id: ACCOUNT,
          platform: 'reveal',
          handle: 'atelier.lune',
          creatorName: 'Lune',
          sessionState: 'valid',
          sessionUpdatedAt: '2026-11-10T09:00:00.000Z',
        },
      ],
    };
    const fetchFn = answer(200, accounts);
    expect(await fetchSyncableAccounts(ORIGIN, TOKEN, fetchFn)).toEqual({ kind: 'ok', value: accounts });
    const [url] = vi.mocked(fetchFn).mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/v1/connector/accounts?platform=reveal`);
  });
});
