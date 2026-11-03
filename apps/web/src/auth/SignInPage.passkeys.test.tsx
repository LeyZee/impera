// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

import { SignInPage } from './SignInPage';

const OPTIONS = { challenge: 'Y2hhbGxlbmdl', userVerification: 'required' };
const CREATION_OPTIONS = {
  challenge: 'Y2hhbGxlbmdl',
  rp: { name: 'Nirvana' },
  user: { id: 'dXNlcg', name: 'lina@example.test', displayName: 'Lina' },
  pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
};
const GESTURE = { id: 'a2V5', rawId: 'a2V5', type: 'public-key', response: {} };
const PASSKEY = {
  id: 'pk-1',
  device: 'Safari sur iPhone',
  keychain: null,
  createdAt: '2026-11-02T20:00:00.000Z',
  lastUsedAt: null,
};

function serve(routes: Record<string, readonly [number, unknown?]>): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? 'GET'} ${url.replace(/^\/v1/u, '')}`;
      calls.push(key);
      const [status, body] = routes[key] ?? [404];
      return Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));
    }),
  );
  return calls;
}

/** The password, then the code, as a person types them. */
async function signInByCode(): Promise<void> {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'lina@example.test' } });
  fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
  fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
  const code = await screen.findByLabelText('Code à 6 chiffres');
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.submit(code.closest('form') ?? document.body);
}

const CODE_ROUTES = {
  'POST /auth/sign-in/email': [200, { twoFactorRedirect: true }],
  'POST /auth/two-factor/verify-totp': [200, {}],
} as const;

beforeEach(() => {
  browser.startAuthentication.mockResolvedValue(GESTURE);
  browser.startRegistration.mockResolvedValue(GESTURE);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('SignInPage with passkeys (ADR 0053)', () => {
  it('signs in with one gesture, no e-mail, no password, no code', async () => {
    serve({
      'GET /auth/passkey/generate-authenticate-options': [200, OPTIONS],
      'POST /auth/passkey/verify-authentication': [200, {}],
    });
    const onSignedIn = vi.fn();
    render(<SignInPage onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByRole('button', { name: /^Se connecter avec / }));
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalled();
    });
  });

  it('says nothing when Face ID is closed, and says plainly a key that opens no account', async () => {
    serve({
      'GET /auth/passkey/generate-authenticate-options': [200, OPTIONS],
      'POST /auth/passkey/verify-authentication': [401, {}],
    });
    render(<SignInPage onSignedIn={() => undefined} />);
    browser.startAuthentication.mockRejectedValueOnce(new Error('NotAllowedError'));
    const button = screen.getByRole('button', { name: /^Se connecter avec / });
    fireEvent.click(button);
    await waitFor(() => {
      expect(button.hasAttribute('disabled')).toBe(false);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(button);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Cette clé n’ouvre aucun compte. Connecte-toi avec ton e-mail, ton mot de passe et ton code.',
    );
  });

  it('offers a key once after a sign-in by the code, and adds it on « Oui, activer »', async () => {
    const calls = serve({
      ...CODE_ROUTES,
      'GET /auth/passkey/generate-register-options': [200, CREATION_OPTIONS],
      'POST /auth/passkey/verify-registration': [200, PASSKEY],
    });
    const onSignedIn = vi.fn();
    render(<SignInPage onSignedIn={onSignedIn} />);
    await signInByCode();
    expect(await screen.findByRole('heading', { name: /la prochaine fois/u })).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Oui, activer' }));
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalled();
    });
    expect(calls).toContain('POST /auth/passkey/verify-registration');

    // Asked once on this device: the next sign-in by the code goes straight in.
    cleanup();
    const again = vi.fn();
    render(<SignInPage onSignedIn={again} />);
    await signInByCode();
    await waitFor(() => {
      expect(again).toHaveBeenCalled();
    });
    expect(screen.queryByRole('heading', { name: /la prochaine fois/u })).toBeNull();
  });

  it('lets « Plus tard » go in without a key, and never offers on a device without Face ID', async () => {
    const calls = serve(CODE_ROUTES);
    const onSignedIn = vi.fn();
    render(<SignInPage onSignedIn={onSignedIn} />);
    await signInByCode();
    fireEvent.click(await screen.findByRole('button', { name: 'Plus tard' }));
    expect(onSignedIn).toHaveBeenCalled();
    expect(calls.some((call) => call.includes('passkey'))).toBe(false);

    cleanup();
    localStorage.clear();
    browser.platformAuthenticatorIsAvailable.mockResolvedValue(false);
    const elsewhere = vi.fn();
    render(<SignInPage onSignedIn={elsewhere} />);
    await signInByCode();
    await waitFor(() => {
      expect(elsewhere).toHaveBeenCalled();
    });
  });
});
