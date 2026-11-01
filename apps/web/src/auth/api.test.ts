// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { forgetTakenToken, inspectInvitationLink, linkPageOf, redeemInvitationLink, takeToken } from './api';

const TOKEN = 'lien-invente-pour-les-tests';
const PREVIEW = {
  purpose: 'invitation',
  email: 'theo@example.test',
  displayName: 'Théo',
  country: 'BJ',
  expiresAt: '2026-10-30T15:00:00.000Z',
};

const ME = {
  id: 'u-theo',
  email: 'theo@example.test',
  name: 'Théo',
  role: 'operator',
  creatorIds: [],
  routedCreatorIds: [],
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};

function refusal(code: string, details: Record<string, unknown> = {}) {
  return { error: { code, message: 'Refusé', details, requestId: 'r1' } };
}

function answer(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  forgetTakenToken();
  window.history.replaceState(null, '', '/');
});

describe('linkPageOf', () => {
  it('knows the two link pages, and nothing else', () => {
    expect(linkPageOf('/bienvenue')).toBe('invitation');
    expect(linkPageOf('/bienvenue/')).toBe('invitation');
    expect(linkPageOf('/nouveau-mot-de-passe')).toBe('reset');
    expect(linkPageOf('/')).toBeNull();
    expect(linkPageOf('/suivi')).toBeNull();
  });
});

describe('takeToken', () => {
  it('reads the token once and takes it out of the address', () => {
    window.history.replaceState(null, '', `/bienvenue#t=${TOKEN}`);
    expect(takeToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/bienvenue');
    // A second render (StrictMode) gets the same token, though the address has none any more.
    expect(takeToken()).toBe(TOKEN);
  });

  it('gives nothing for a cut or altered link, and still cleans the address', () => {
    window.history.replaceState(null, '', '/bienvenue#t=abc');
    expect(takeToken()).toBeNull();
    expect(window.location.hash).toBe('');
  });
});

describe('inspectInvitationLink', () => {
  it('posts the token in the body, never in the address', async () => {
    answer(200, PREVIEW);
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'ok', preview: PREVIEW });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe('/v1/invitation-links/inspect');
    expect(init?.method).toBe('POST');
    expect(init?.referrerPolicy).toBe('no-referrer');
    expect(init?.body).toBe(JSON.stringify({ token: TOKEN }));
  });

  it('tells a dead link, a limiter and a silent server apart, nothing more', async () => {
    answer(404, refusal('invitation_link_not_found'));
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'gone' });
    // A proxy that answers in the server's place says it by its status alone.
    answer(404);
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'gone' });
    answer(429, refusal('rate_limited'));
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'too_many_attempts' });
    answer(429);
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'too_many_attempts' });
    answer(502);
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'unavailable' });
    answer(200, { email: 'not a preview' });
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'unavailable' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    );
    expect(await inspectInvitationLink(TOKEN)).toEqual({ kind: 'unavailable' });
  });
});

describe('redeemInvitationLink', () => {
  it('posts the token and the password in the body, and gives the member the server opened', async () => {
    answer(200, ME);
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({ kind: 'ok', me: ME });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url).toBe('/v1/invitation-links/redeem');
    expect(init?.method).toBe('POST');
    expect(init?.referrerPolicy).toBe('no-referrer');
    expect(init?.body).toBe(JSON.stringify({ token: TOKEN, password: 'une phrase longue' }));
  });

  it('keeps the member in when the answer cannot be read: the link is used by now', async () => {
    answer(200, { email: 'not a member' });
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({ kind: 'ok', me: null });
  });

  it('says why a password was not set', async () => {
    answer(400, refusal('password_invalid', { reason: 'too_short' }));
    expect(await redeemInvitationLink(TOKEN, 'court')).toEqual({
      kind: 'password_refused',
      reason: 'too_short',
    });
    answer(400, refusal('password_invalid'));
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({
      kind: 'password_refused',
      reason: 'refused',
    });
    answer(400);
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({
      kind: 'password_refused',
      reason: 'refused',
    });
  });

  it('says a dead link, a member who left and a limiter, nothing more', async () => {
    answer(404, refusal('invitation_link_not_found'));
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({ kind: 'gone' });
    answer(409, refusal('member_left_conflict'));
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({ kind: 'gone' });
    answer(429, refusal('rate_limited'));
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({ kind: 'too_many_attempts' });
    answer(500, refusal('internal_error'));
    expect(await redeemInvitationLink(TOKEN, 'une phrase longue')).toEqual({ kind: 'unavailable' });
  });
});
