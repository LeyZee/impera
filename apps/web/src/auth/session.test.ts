import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCurrentUser, normalizeCode, readSession, signIn, signOut, verifySignInCode } from './session';

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
      shiftCreatorIds: [],
      team: null,
      teamScope: 'owner',
    };
    answer(200, { state: 'signed_in', me: user });
    expect(await fetchCurrentUser()).toEqual(user);
    answer(200, { state: 'signed_out' });
    expect(await fetchCurrentUser()).toBeNull();
  });

  it('refuses a /v1/session answer that does not match the contract', async () => {
    answer(200, { state: 'signed_in', me: { id: 'u1', role: 'admin' } });
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

  it('asks for the code when the password was right on an account whose code is active (ADR 0046)', async () => {
    answer(200, { twoFactorRedirect: true });
    expect(await signIn('a@example.test', 'x')).toBe('code_required');
    answer(200, { user: { id: 'u1' } });
    expect(await signIn('a@example.test', 'x')).toBe('ok');
  });

  it('opens the activation, and only it, for an account whose code is not active yet', async () => {
    answer(200, { state: 'second_factor_required' });
    expect(await readSession()).toEqual({ kind: 'second_factor_required' });
    expect(await fetchCurrentUser()).toBeNull();
    // A server that does not answer is not « no session ».
    answer(502);
    await expect(readSession()).rejects.toThrow('GET /v1/session: 502');
  });

  it('sends the code of a sign-in to the right check, and tells its refusals apart', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    expect(await verifySignInCode('123456', { backup: false, trustDevice: true })).toBe('ok');
    expect(await verifySignInCode('abcde-fghij', { backup: true, trustDevice: false })).toBe('ok');
    expect(calls).toEqual([
      '/v1/auth/two-factor/verify-totp {"code":"123456","trustDevice":true}',
      '/v1/auth/two-factor/verify-backup-code {"code":"abcde-fghij","trustDevice":false}',
    ]);
    const refused = (code: string, status: number) => {
      answer(status, { error: { code, message: 'x', details: {}, requestId: 'r' } });
      return verifySignInCode('123456', { backup: false, trustDevice: false });
    };
    expect(await refused('second_factor_unauthenticated', 401)).toBe('wrong_code');
    expect(await refused('second_factor_challenge_unauthenticated', 401)).toBe('expired');
    expect(await refused('second_factor_limited', 429)).toBe('locked');
    expect(await refused('rate_limited', 429)).toBe('too_many_attempts');
  });

  it('sends a backup code as the server reads it, its letters untouched (recette 05/11, SEC-08)', async () => {
    expect(normalizeCode(' mSpVs JE09z ')).toBe('mSpVs-JE09z');
    expect(normalizeCode('mSpVsJE09z')).toBe('mSpVs-JE09z');
    expect(normalizeCode('mSpVs–JE09z')).toBe('mSpVs-JE09z');
    expect(normalizeCode('123 456')).toBe('123456');
    // Ten digits are no backup code: left as they are, the server refuses them.
    expect(normalizeCode('1234567890')).toBe('1234567890');
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
        return Promise.resolve(new Response('{}', { status: 200 }));
      }),
    );
    await verifySignInCode('mSpVs — JE09z', { backup: true, trustDevice: false });
    expect(calls).toEqual([
      '/v1/auth/two-factor/verify-backup-code {"code":"mSpVs-JE09z","trustDevice":false}',
    ]);
  });

  it('throws when the server did not close the session, so that the page can say so (recette 28/10, G9)', async () => {
    answer(200);
    await expect(signOut()).resolves.toBeUndefined();
    answer(500);
    await expect(signOut()).rejects.toThrow('POST /v1/auth/sign-out: 500');
  });
});
