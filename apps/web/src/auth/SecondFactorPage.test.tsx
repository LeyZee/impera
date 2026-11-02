// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecondFactorPage, keyOf } from './SecondFactorPage';

/** Invented values: a key and ten codes shaped like the server's, nothing real. */
const URI = 'otpauth://totp/Nirvana:a%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Nirvana';
const BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `code${String(i)}-inven`);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function serve(answers: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
      const answer = answers[url];
      return Promise.resolve(answer === undefined ? new Response('{}', { status: 500 }) : answer());
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function givePassword(): Promise<void> {
  const password = screen.getByLabelText('Mot de passe');
  fireEvent.change(password, { target: { value: 'staple battery horse' } });
  fireEvent.submit(password.closest('form') ?? document.body);
  await screen.findByText('Ajoute Nirvana dans ton application');
}

describe('SecondFactorPage', () => {
  it('groups the key by four, to be typed without losing one’s place', () => {
    expect(keyOf(URI)).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP');
  });

  it('walks password, key, first code, then the ten backup codes before opening Nirvana', async () => {
    const calls = serve({
      '/v1/auth/two-factor/enable': () => json({ totpURI: URI, backupCodes: BACKUP_CODES }),
      '/v1/auth/two-factor/verify-totp': () => json({ token: 'x' }),
    });
    const onActivated = vi.fn();
    render(<SecondFactorPage onActivated={onActivated} onSignOut={() => undefined} />);
    await givePassword();
    expect(screen.getByRole('link', { name: 'Ouvrir dans l’application' }).getAttribute('href')).toBe(URI);
    expect(screen.getByLabelText('Clé à recopier dans l’application').textContent).toBe(keyOf(URI));
    const code = screen.getByLabelText('Code affiché par l’application');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form') ?? document.body);
    const list = await screen.findByLabelText('Codes de secours');
    expect(list.querySelectorAll('li')).toHaveLength(10);
    // Nirvana opens only once the person says the codes are kept.
    const open = screen.getByRole('button', { name: 'Ouvrir Nirvana' });
    expect(open).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('J’ai mis ces codes en lieu sûr.'));
    fireEvent.click(open);
    expect(onActivated).toHaveBeenCalled();
    expect(calls).toEqual([
      '/v1/auth/two-factor/enable {"password":"staple battery horse"}',
      '/v1/auth/two-factor/verify-totp {"code":"123456"}',
    ]);
  });

  it('says a wrong password, and a wrong first code, in words', async () => {
    let enable = () =>
      json({ error: { code: 'password_unauthenticated', message: 'x', details: {}, requestId: 'r' } }, 401);
    serve({
      '/v1/auth/two-factor/enable': () => enable(),
      '/v1/auth/two-factor/verify-totp': () =>
        json(
          { error: { code: 'second_factor_unauthenticated', message: 'x', details: {}, requestId: 'r' } },
          401,
        ),
    });
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    const password = screen.getByLabelText('Mot de passe');
    fireEvent.change(password, { target: { value: 'wrong' } });
    fireEvent.submit(password.closest('form') ?? document.body);
    expect(await screen.findByText('Ce n’est pas le bon mot de passe.')).toBeDefined();
    enable = () => json({ totpURI: URI, backupCodes: BACKUP_CODES });
    await givePassword();
    const code = screen.getByLabelText('Code affiché par l’application');
    fireEvent.change(code, { target: { value: '000000' } });
    fireEvent.submit(code.closest('form') ?? document.body);
    expect(
      await screen.findByText(
        'Ce code ne marche pas. Vérifie l’heure de ton téléphone et recopie le code affiché.',
      ),
    ).toBeDefined();
    expect(screen.queryByLabelText('Codes de secours')).toBeNull();
  });

  it('lets the person sign out before the codes are shown', async () => {
    serve({});
    const onSignOut = vi.fn();
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={onSignOut} />);
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    await waitFor(() => {
      expect(onSignOut).toHaveBeenCalled();
    });
  });
});
