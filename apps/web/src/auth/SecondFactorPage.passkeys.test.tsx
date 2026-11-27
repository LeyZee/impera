// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const browser = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  platformAuthenticatorIsAvailable: vi.fn(() => Promise.resolve(true)),
}));
vi.mock('@simplewebauthn/browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/browser')>()),
  ...browser,
}));

import { SecondFactorPage } from './SecondFactorPage';

/** Invented values: a key and ten codes shaped like the server's, nothing real. */
const URI = 'otpauth://totp/Impera:a%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Impera';
const BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `code${String(i)}-inven`);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/v1/auth/two-factor/enable'
          ? new Response(JSON.stringify({ totpURI: URI, backupCodes: BACKUP_CODES }), { status: 200 })
          : new Response(JSON.stringify({ token: 'x' }), { status: 200 }),
      ),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The password, a first code, the codes kept: the end of the activation. */
async function activate(): Promise<void> {
  const password = screen.getByLabelText('Mot de passe');
  fireEvent.change(password, { target: { value: 'staple battery horse' } });
  fireEvent.submit(password.closest('form') ?? document.body);
  const code = await screen.findByLabelText('Code affiché par l’application');
  fireEvent.change(code, { target: { value: '123456' } });
  fireEvent.submit(code.closest('form') ?? document.body);
  fireEvent.click(await screen.findByLabelText('J’ai mis ces codes en lieu sûr.'));
  fireEvent.click(screen.getByRole('button', { name: 'Ouvrir Impera' }));
}

describe('SecondFactorPage on a device with Face ID (recette 27/11, P2)', () => {
  it('offers a key once the backup codes are kept, and « Plus tard » opens Impera', async () => {
    const onActivated = vi.fn();
    render(<SecondFactorPage onActivated={onActivated} onSignOut={() => undefined} />);
    await activate();
    expect(await screen.findByRole('heading', { name: /la prochaine fois/u })).toBeTruthy();
    expect(onActivated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(onActivated).toHaveBeenCalled();
  });

  it('does not offer it again on a device where it was already asked', async () => {
    localStorage.setItem('nv-passkey-offered', '1');
    const onActivated = vi.fn();
    render(<SecondFactorPage onActivated={onActivated} onSignOut={() => undefined} />);
    await activate();
    await waitFor(() => {
      expect(onActivated).toHaveBeenCalled();
    });
    expect(screen.queryByRole('button', { name: 'Plus tard' })).toBeNull();
  });
});
