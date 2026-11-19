import { describe, expect, it } from 'vitest';

import { memberOfBearer, NO_PARTS, readRequest, sessionOf, type SessionParts } from './capture';

// Invented values: never a real token, member or model (ADR 0010).
const BEARER = 'invented-bearer-0123456789abcdef';
const AUTH = [{ name: 'Authorization', value: `Bearer ${BEARER}` }];

/** An invented JWT whose claims are `claims`; its signature is never checked here. */
function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.invented-signature`;
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
    expect(parts).toEqual({ bearer: BEARER, modelId: 'model-a1', userId: 'member-b2' });
  });

  it('reads the model from /models/:id and from /<kind>/model/:id', () => {
    expect(seen(['https://api.reveal.me/models/model-c3/vault-folders', undefined]).modelId).toBe('model-c3');
    expect(seen(['https://api.reveal.me/scripts/model/model-d4?take=20', undefined]).modelId).toBe(
      'model-d4',
    );
    expect(seen(['https://api.reveal.me/conversations/conv-1/messages', undefined]).modelId).toBeNull();
  });

  it('keeps the first value seen', () => {
    const parts = seen(
      ['https://api.reveal.me/models/model-a1', AUTH],
      [
        'https://api.reveal.me/models/model-z9',
        [{ name: 'authorization', value: 'Bearer another-bearer-000000000' }],
      ],
    );
    expect(parts.modelId).toBe('model-a1');
    expect(parts.bearer).toBe(BEARER);
  });

  it('ignores other hosts, other schemes and malformed headers', () => {
    expect(seen(['https://dashboard.reveal.me/users/member-b2/x?modelId=model-a1', AUTH])).toEqual(NO_PARTS);
    expect(seen(['http://api.reveal.me/models/model-a1', AUTH])).toEqual(NO_PARTS);
    expect(seen(['not a url', AUTH])).toEqual(NO_PARTS);
    expect(
      seen(['https://api.reveal.me/models/model-a1', [{ name: 'Authorization', value: 'Basic abc' }]]).bearer,
    ).toBeNull();
    expect(seen(['https://api.reveal.me/models/a%20b', undefined]).modelId).toBeNull();
  });

  it('composes the session of the specification once the three parts are seen', () => {
    const now = new Date('2026-11-11T15:00:00.000Z');
    expect(sessionOf({ ...NO_PARTS, bearer: BEARER, modelId: 'model-a1' }, 'UA', now)).toBeNull();
    expect(
      sessionOf({ bearer: BEARER, modelId: 'model-a1', userId: 'member-b2' }, 'Mozilla/5.0 test', now),
    ).toEqual({
      v: 1,
      bearer: BEARER,
      userId: 'member-b2',
      modelId: 'model-a1',
      userAgent: 'Mozilla/5.0 test',
      capturedAt: '2026-11-11T15:00:00.000Z',
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
    const session = sessionOf(parts, 'UA', new Date('2026-11-19T17:00:00.000Z'));
    expect(session?.userId).toBe('member-b2');
  });

  it('composes the session from the bearer and the model alone when the claims name the member', () => {
    const token = jwt({ userId: 'member-b2' });
    const parts = seen([
      'https://api.reveal.me/models/model-a1',
      [{ name: 'Authorization', value: `Bearer ${token}` }],
    ]);
    expect(sessionOf(parts, 'UA', new Date('2026-11-19T17:00:00.000Z'))?.userId).toBe('member-b2');
  });

  it('falls back on a route’s member when the bearer names none', () => {
    expect(memberOfBearer(BEARER)).toBeNull();
    expect(memberOfBearer(jwt({ exp: 1 }))).toBeNull();
    expect(memberOfBearer(jwt({ userId: 'a b' }))).toBeNull();
    expect(memberOfBearer('a.%%%.c')).toBeNull();
    const parts = seen(['https://api.reveal.me/users/member-b2/notifications?modelId=model-a1', AUTH]);
    expect(sessionOf(parts, 'UA', new Date('2026-11-19T17:00:00.000Z'))?.userId).toBe('member-b2');
  });
});
