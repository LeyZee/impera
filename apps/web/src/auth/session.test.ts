import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCurrentUser, signIn, signOut } from './session';

function answer(status: number, body: unknown = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dashboard session', () => {
  it('reads the signed-in user, or null without a session', async () => {
    const user = {
      id: 'u1',
      email: 'owner@example.test',
      name: 'Owner',
      role: 'owner',
      creatorIds: [],
      routedCreatorIds: [],
      team: null,
      teamScope: 'owner',
    };
    answer(200, user);
    expect(await fetchCurrentUser()).toEqual(user);
    answer(401);
    expect(await fetchCurrentUser()).toBeNull();
  });

  it('refuses a /v1/me answer that does not match the contract', async () => {
    answer(200, { id: 'u1', role: 'admin' });
    await expect(fetchCurrentUser()).rejects.toThrow();
  });

  it('turns sign-in statuses into a reason the page can show', async () => {
    answer(200);
    expect(await signIn('a@example.test', 'x')).toBe('ok');
    answer(401);
    expect(await signIn('a@example.test', 'x')).toBe('wrong_credentials');
    answer(429);
    expect(await signIn('a@example.test', 'x')).toBe('too_many_attempts');
    answer(502);
    expect(await signIn('a@example.test', 'x')).toBe('unavailable');
  });

  it('throws when the server did not close the session, so that the page can say so (recette 28/10, G9)', async () => {
    answer(200);
    await expect(signOut()).resolves.toBeUndefined();
    answer(500);
    await expect(signOut()).rejects.toThrow('POST /v1/auth/sign-out: 500');
  });
});
