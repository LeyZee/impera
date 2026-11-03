// @vitest-environment jsdom
import { WebAuthnError } from '@simplewebauthn/browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  platformAuthenticatorIsAvailable: vi.fn(() => Promise.resolve(true)),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  ...browser,
}));

import {
  addPasskey,
  confirmWithPasskey,
  deviceHoldsPasskeys,
  gestureName,
  passkeyOffered,
  rememberPasskeyOffered,
  signInWithPasskey,
} from './passkeys';

interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

const REQUEST_OPTIONS = { challenge: 'Y2hhbGxlbmdl', userVerification: 'required', allowCredentials: [] };
const CREATION_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'Impera', id: 'localhost' },
  user: { id: 'dXNlcg', name: 'lina@example.test', displayName: 'Lina' },
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
};
const GESTURE = { id: 'a2V5', rawId: 'a2V5', type: 'public-key', response: {}, clientExtensionResults: {} };
const PASSKEY = {
  id: 'pk-1',
  device: 'Safari sur iPhone',
  keychain: 'iCloud Keychain',
  createdAt: '2026-11-02T20:00:00.000Z',
  lastUsedAt: null,
};
const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1`: each `METHOD path` answered with its status and body, every call kept. */
function serve(routes: Record<string, readonly [number, unknown?]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      calls.push({ method, path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      const [status, body] = routes[`${method} ${path}`] ?? [404];
      return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
    }),
  );
  return calls;
}

beforeEach(() => {
  browser.startAuthentication.mockResolvedValue(GESTURE);
  browser.startRegistration.mockResolvedValue(GESTURE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('the gesture’s name', () => {
  it('names the gesture as the device knows it', () => {
    expect(gestureName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)')).toBe('Face ID');
    expect(gestureName('Mozilla/5.0 (Linux; Android 15; Pixel 9)')).toBe('ton empreinte');
    expect(gestureName('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)', 0)).toBe('Touch ID');
    // Safari on an iPad calls itself a Mac, with a touch screen.
    expect(gestureName('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)', 5)).toBe('Face ID');
    expect(gestureName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows Hello');
    expect(gestureName('Mozilla/5.0 (X11; Linux x86_64)')).toBe('une clé d’accès');
  });
});

describe('signInWithPasskey', () => {
  it('signs in with the options of the server and the gesture of the browser', async () => {
    const calls = serve({
      'GET /auth/passkey/generate-authenticate-options': [200, REQUEST_OPTIONS],
      'POST /auth/passkey/verify-authentication': [200, { redirect: false }],
    });
    expect(await signInWithPasskey()).toBe('ok');
    expect(browser.startAuthentication).toHaveBeenCalledWith({ optionsJSON: REQUEST_OPTIONS });
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/auth/passkey/verify-authentication',
      body: { response: GESTURE },
    });
  });

  it('sends nothing when the person closes Face ID, and says a refusal apart from a limit', async () => {
    const calls = serve({ 'GET /auth/passkey/generate-authenticate-options': [200, REQUEST_OPTIONS] });
    browser.startAuthentication.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(await signInWithPasskey()).toBe('cancelled');
    expect(calls).toHaveLength(1);

    serve({
      'GET /auth/passkey/generate-authenticate-options': [200, REQUEST_OPTIONS],
      'POST /auth/passkey/verify-authentication': [401, apiError('passkey_unauthenticated')],
    });
    expect(await signInWithPasskey()).toBe('refused');
    serve({ 'GET /auth/passkey/generate-authenticate-options': [429, apiError('rate_limited')] });
    expect(await signInWithPasskey()).toBe('too_many_attempts');
    serve({ 'GET /auth/passkey/generate-authenticate-options': [200, { nothing: true }] });
    expect(await signInWithPasskey()).toBe('unavailable');
  });
});

describe('confirmWithPasskey', () => {
  it('leaves out the key being removed, and confirms with another one', async () => {
    const calls = serve({
      'POST /auth/passkey/confirm-options': [200, REQUEST_OPTIONS],
      'POST /auth/passkey/confirm': [204],
    });
    expect(await confirmWithPasskey('pk-1')).toBe('ok');
    expect(calls[0]?.body).toEqual({ excluding: 'pk-1' });
    expect(await confirmWithPasskey()).toBe('ok');
    expect(calls[2]?.body).toEqual({});
  });

  it('tells an account without a key, a refused gesture and an expired session apart', async () => {
    serve({ 'POST /auth/passkey/confirm-options': [404, apiError('passkey_not_found')] });
    expect(await confirmWithPasskey()).toBe('no_passkey');
    serve({
      'POST /auth/passkey/confirm-options': [200, REQUEST_OPTIONS],
      'POST /auth/passkey/confirm': [401, apiError('passkey_unauthenticated')],
    });
    expect(await confirmWithPasskey()).toBe('refused');
    serve({
      'POST /auth/passkey/confirm-options': [200, REQUEST_OPTIONS],
      'POST /auth/passkey/confirm': [401, apiError('session_unauthenticated')],
    });
    expect(await confirmWithPasskey()).toBe('session_expired');
  });
});

describe('addPasskey', () => {
  it('adds a key of this device and answers it as the server lists it', async () => {
    const calls = serve({
      'GET /auth/passkey/generate-register-options': [200, CREATION_OPTIONS],
      'POST /auth/passkey/verify-registration': [200, PASSKEY],
    });
    expect(await addPasskey()).toEqual({ kind: 'ok', passkey: PASSKEY });
    expect(calls[1]?.body).toEqual({ response: GESTURE });
  });

  it('asks for the password and the code past 5 minutes, and knows a device that already holds a key', async () => {
    serve({ 'GET /auth/passkey/generate-register-options': [403, apiError('reauthentication_forbidden')] });
    expect(await addPasskey()).toEqual({ kind: 'reauth_required' });
    expect(browser.startRegistration).not.toHaveBeenCalled();

    serve({ 'GET /auth/passkey/generate-register-options': [200, CREATION_OPTIONS] });
    browser.startRegistration.mockRejectedValueOnce(
      new WebAuthnError({
        message: 'already',
        code: 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED',
        cause: new Error('InvalidStateError'),
      }),
    );
    expect(await addPasskey()).toEqual({ kind: 'already' });
    browser.startRegistration.mockRejectedValueOnce(new Error('NotAllowedError'));
    expect(await addPasskey()).toEqual({ kind: 'cancelled' });
  });
});

describe('the offer after a sign-in', () => {
  it('is made once per device, and only on a device that holds keys', async () => {
    expect(passkeyOffered()).toBe(false);
    rememberPasskeyOffered();
    expect(passkeyOffered()).toBe(true);
    expect(await deviceHoldsPasskeys()).toBe(true);
    browser.platformAuthenticatorIsAvailable.mockResolvedValueOnce(false);
    expect(await deviceHoldsPasskeys()).toBe(false);
    browser.browserSupportsWebAuthn.mockReturnValueOnce(false);
    expect(await deviceHoldsPasskeys()).toBe(false);
  });
});
