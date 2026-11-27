import { describe, expect, it } from 'vitest';

import {
  memberOfBearer,
  modelFor,
  NO_PARTS,
  readRequest,
  sessionOf,
  type Captured,
  type SessionParts,
} from './capture';

// Invented values: never a real token, member or model (ADR 0010).
const BEARER = 'invented-bearer-0123456789abcdef';
const AUTH = [{ name: 'Authorization', value: `Bearer ${BEARER}` }];

/** An invented JWT whose claims are `claims`; its signature is never checked here. */
function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.invented-signature`;
}

/** The member of a session read; null when none was read. */
function memberOf(captured: Captured | null): string | null {
  return captured?.state === 'session' ? captured.session.userId : null;
}

function seen(...requests: readonly [string, typeof AUTH | undefined][]): SessionParts {
  return requests.reduce<SessionParts>((parts, [url, headers]) => readRequest(parts, url, headers), NO_PARTS);
}

describe('the Reveal session read from the tab’s requests', () => {
  it('takes the bearer, the model and the member from the routes that carry them', () => {
    const parts = seen(
      ['https://api.reveal.me/conversations/model?filter=all&take=20&modelId=model-a1', AUTH],
      ['https://api.reveal.me/users/member-b2/notifications?take=10', AUTH],
    );
    expect(parts).toEqual({ bearer: BEARER, models: ['model-a1'], userId: 'member-b2' });
  });

  it('reads the model from /models/:id and from /<kind>/model/:id', () => {
    expect(seen(['https://api.reveal.me/models/model-c3/vault-folders', undefined]).models).toEqual([
      'model-c3',
    ]);
    expect(seen(['https://api.reveal.me/scripts/model/model-d4?take=20', undefined]).models).toEqual([
      'model-d4',
    ]);
    expect(seen(['https://api.reveal.me/conversations/conv-1/messages', undefined]).models).toEqual([]);
  });

  it('keeps the first bearer, and every model the tab names, once each and in order (19/11, 409)', () => {
    const parts = seen(
      ['https://api.reveal.me/models/model-a1', AUTH],
      [
        'https://api.reveal.me/models/model-z9',
        [{ name: 'authorization', value: 'Bearer another-bearer-000000000' }],
      ],
    );
    expect(parts.models).toEqual(['model-a1', 'model-z9']);
    expect(parts.bearer).toBe(BEARER);
    expect(
      seen(['https://api.reveal.me/models/model-a1', AUTH], ['https://api.reveal.me/models/model-a1', AUTH])
        .models,
    ).toEqual(['model-a1']);
  });

  it('ignores other hosts, other schemes and malformed headers', () => {
    expect(seen(['https://dashboard.reveal.me/users/member-b2/x?modelId=model-a1', AUTH])).toEqual(NO_PARTS);
    expect(seen(['http://api.reveal.me/models/model-a1', AUTH])).toEqual(NO_PARTS);
    expect(seen(['not a url', AUTH])).toEqual(NO_PARTS);
    expect(
      seen(['https://api.reveal.me/models/model-a1', [{ name: 'Authorization', value: 'Basic abc' }]]).bearer,
    ).toBeNull();
    expect(seen(['https://api.reveal.me/models/a%20b', undefined]).models).toEqual([]);
  });

  it('composes the session of the specification once the three parts are seen', () => {
    const now = new Date('2026-11-11T15:00:00.000Z');
    expect(sessionOf({ ...NO_PARTS, bearer: BEARER, models: ['model-a1'] }, null, 'UA', now)).toBeNull();
    expect(sessionOf({ bearer: BEARER, models: [], userId: 'member-b2' }, null, 'UA', now)).toBeNull();
    expect(
      sessionOf({ bearer: BEARER, models: ['model-a1'], userId: 'member-b2' }, null, 'Mozilla/5.0 test', now),
    ).toEqual({
      state: 'session',
      session: {
        v: 1,
        bearer: BEARER,
        userId: 'member-b2',
        modelId: 'model-a1',
        userAgent: 'Mozilla/5.0 test',
        capturedAt: '2026-11-11T15:00:00.000Z',
      },
    });
  });

  it('ignores /users/me/…, which names no one', () => {
    expect(seen(['https://api.reveal.me/users/me/context', AUTH]).userId).toBeNull();
    expect(seen(['https://api.reveal.me/users/Me/context', AUTH]).userId).toBeNull();
  });

  it('takes the member from the bearer’s claims, whatever route came first (19/11)', () => {
    const token = jwt({ userId: 'member-b2', exp: 1_900_000_000 });
    const auth = [{ name: 'Authorization', value: `Bearer ${token}` }];
    const parts = seen(
      ['https://api.reveal.me/users/me/context', auth],
      ['https://api.reveal.me/users/member-x9/profile', auth],
      ['https://api.reveal.me/models/model-a1', auth],
    );
    expect(memberOf(sessionOf(parts, null, 'UA', new Date('2026-11-19T17:00:00.000Z')))).toBe('member-b2');
  });

  it('composes the session from the bearer and the model alone when the claims name the member', () => {
    const token = jwt({ userId: 'member-b2' });
    const parts = seen([
      'https://api.reveal.me/models/model-a1',
      [{ name: 'Authorization', value: `Bearer ${token}` }],
    ]);
    expect(memberOf(sessionOf(parts, null, 'UA', new Date('2026-11-19T17:00:00.000Z')))).toBe('member-b2');
  });

  it('falls back on a route’s member when the bearer names none', () => {
    expect(memberOfBearer(BEARER)).toBeNull();
    expect(memberOfBearer(jwt({ exp: 1 }))).toBeNull();
    expect(memberOfBearer(jwt({ userId: 'a b' }))).toBeNull();
    expect(memberOfBearer('a.%%%.c')).toBeNull();
    const parts = seen(['https://api.reveal.me/users/member-b2/notifications?modelId=model-a1', AUTH]);
    expect(memberOf(sessionOf(parts, null, 'UA', new Date('2026-11-19T17:00:00.000Z')))).toBe('member-b2');
  });
});

// 19/11: the tab named another creator first, and the CRM refused the session (409). The account's model wins.
describe('the model a session speaks for', () => {
  it('takes the account’s model when the tab named it, wherever it came', () => {
    expect(modelFor(['model-z9', 'model-a1'], 'model-a1')).toEqual({ state: 'one', modelId: 'model-a1' });
  });

  it('takes the only model the tab named, the account’s or not', () => {
    expect(modelFor(['model-a1'], null)).toEqual({ state: 'one', modelId: 'model-a1' });
    expect(modelFor(['model-z9'], 'model-a1')).toEqual({ state: 'one', modelId: 'model-z9' });
  });

  it('says several creators when the tab named more and none is the account’s', () => {
    expect(modelFor(['model-z9', 'model-y8'], 'model-a1')).toEqual({ state: 'several' });
    expect(modelFor(['model-z9', 'model-y8'], null)).toEqual({ state: 'several' });
  });

  it('still sees the account’s model after the tab named many others (relecture de Bilan)', () => {
    const others = Array.from({ length: 20 }, (_, i): [string, typeof AUTH] => [
      `https://api.reveal.me/models/model-o${String(i)}`,
      AUTH,
    ]);
    const parts = seen(...others, ['https://api.reveal.me/models/model-a1', AUTH]);
    expect(modelFor(parts.models, 'model-a1')).toEqual({ state: 'one', modelId: 'model-a1' });
  });

  it('waits while the tab named none', () => {
    expect(modelFor([], 'model-a1')).toBeNull();
  });

  it('composes the session for the account’s model, the first one seen being another', () => {
    const token = jwt({ userId: 'member-b2' });
    const auth = [{ name: 'Authorization', value: `Bearer ${token}` }];
    const parts = seen(
      ['https://api.reveal.me/models/model-z9', auth],
      ['https://api.reveal.me/models/model-a1', auth],
    );
    const captured = sessionOf(parts, 'model-a1', 'UA', new Date('2026-11-19T20:00:00.000Z'));
    expect(captured?.state === 'session' ? captured.session.modelId : captured).toBe('model-a1');
    expect(sessionOf(parts, null, 'UA', new Date('2026-11-19T20:00:00.000Z'))).toEqual({ state: 'several' });
  });
});
