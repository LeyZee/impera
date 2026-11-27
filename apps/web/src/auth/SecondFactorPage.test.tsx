// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SecondFactorPage, keyOf } from './SecondFactorPage';
import { activationStarted, clearActivationStarted, markActivationStarted } from './activation-started';
import { chosenPassword, forgetChosenPassword, holdChosenPassword } from './chosen-password';
import { codesUnconfirmed } from './codes-pending';

/** Invented values: a key and ten codes shaped like the server's, nothing real. */
const URI = 'otpauth://totp/Impera:a%40example.test?secret=JBSWY3DPEHPK3PXPJBSWY3DP&issuer=Impera';
const BACKUP_CODES = Array.from({ length: 10 }, (_, i) => `code${String(i)}-inven`);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetChosenPassword();
  clearActivationStarted();
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

const refusal = (code: string, status: number) =>
  json({ error: { code, message: 'x', details: {}, requestId: 'r' } }, status);

/** The first step, on a session that has just proven the password: it only explains. */
async function start(): Promise<void> {
  expect(screen.queryByLabelText('Mot de passe')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  await screen.findByText('Ajoute Impera dans ton application');
}

async function givePassword(): Promise<void> {
  const password = await screen.findByLabelText('Mot de passe');
  fireEvent.change(password, { target: { value: 'staple battery horse' } });
  fireEvent.submit(password.closest('form') ?? document.body);
  await screen.findByText('Ajoute Impera dans ton application');
}

describe('SecondFactorPage', () => {
  it('groups the key by four, to be typed without losing one’s place', () => {
    expect(keyOf(URI)).toBe('JBSW Y3DP EHPK 3PXP JBSW Y3DP');
  });

  it('walks the first step, key, first code, then the ten backup codes before opening Impera', async () => {
    const calls = serve({
      '/v1/auth/two-factor/enable': () => json({ totpURI: URI, backupCodes: BACKUP_CODES }),
      '/v1/auth/two-factor/verify-totp': () => json({ token: 'x' }),
    });
    const onActivated = vi.fn();
    render(<SecondFactorPage onActivated={onActivated} onSignOut={() => undefined} />);
    await start();
    // A reload from here comes back to this key (recette 27/11, A8).
    expect(activationStarted()).toBe(true);
    const open = screen.getByRole('link', { name: 'Ouvrir dans l’application' });
    expect(open.getAttribute('href')).toBe(URI);
    // A phone's button only, and no button named that does not exist (recette 27/11, CH-12).
    expect(open.className).toContain('sm:hidden');
    expect(screen.queryByText(/Saisir une clé/u)).toBeNull();
    const key = screen.getByLabelText('Clé à recopier dans l’application');
    expect(key.textContent).toBe(keyOf(URI));
    // On a computer, the app scans a QR code of the same link (recette 27/11, G7).
    expect(
      screen
        .getByRole('img', { name: 'Code à scanner avec l’application' })
        .querySelector('path')
        ?.getAttribute('d'),
    ).toMatch(/^M\d/u);
    // A narrow screen wraps the key between its groups, never inside one (recette 11/11, SOC-02).
    expect(key.className).toContain('break-words');
    expect(key.className).not.toContain('break-all');
    const code = screen.getByLabelText('Code affiché par l’application');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form') ?? document.body);
    const list = await screen.findByLabelText('Codes de secours');
    expect(list.querySelectorAll('li')).toHaveLength(10);
    // Until they are said kept, leaving asks first and Sécurité will say so (recette COUV-08).
    expect(codesUnconfirmed()).toBe(true);
    const leave = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leave);
    expect(leave.defaultPrevented).toBe(true);
    // Impera opens only once the person says the codes are kept.
    expect(activationStarted()).toBe(false);
    const enter = screen.getByRole('button', { name: 'Ouvrir Impera' });
    expect(enter).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('J’ai mis ces codes en lieu sûr.'));
    fireEvent.click(enter);
    // No Face ID in this browser: no offer of a key, Impera opens.
    await waitFor(() => {
      expect(onActivated).toHaveBeenCalled();
    });
    expect(codesUnconfirmed()).toBe(false);
    expect(calls).toEqual([
      '/v1/auth/two-factor/enable {}',
      '/v1/auth/two-factor/verify-totp {"code":"123456"}',
      // Said on the account, so a reload does not skip it (recette 27/11, CH-11).
      '/v1/me/first-steps/codes-kept {}',
    ]);
  });

  it('comes back to the same key after a reload, without the first step (recette 27/11, A8)', async () => {
    const calls = serve({
      '/v1/auth/two-factor/enable': () => json({ totpURI: URI, backupCodes: BACKUP_CODES }),
    });
    markActivationStarted();
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    await screen.findByText('Ajoute Impera dans ton application');
    expect(screen.getByLabelText('Clé à recopier dans l’application').textContent).toBe(keyOf(URI));
    expect(calls).toEqual(['/v1/auth/two-factor/enable {}']);
  });

  it('asks for the password when the server wants it again, then shows the key', async () => {
    let enable = () => refusal('password_missing_forbidden', 403);
    const calls = serve({ '/v1/auth/two-factor/enable': () => enable() });
    markActivationStarted();
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    expect(await screen.findByText('Installe-la, puis confirme ton mot de passe.')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    enable = () => json({ totpURI: URI, backupCodes: BACKUP_CODES });
    await givePassword();
    expect(calls).toEqual([
      '/v1/auth/two-factor/enable {}',
      '/v1/auth/two-factor/enable {"password":"staple battery horse"}',
    ]);
  });

  it('does not ask again for the password chosen a moment ago on the link page (recette SEC-15)', async () => {
    const calls = serve({
      '/v1/auth/two-factor/enable': () => json({ totpURI: URI, backupCodes: BACKUP_CODES }),
    });
    holdChosenPassword('staple battery horse');
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    expect(screen.getByText('Installe-la, puis continue.')).toBeDefined();
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await screen.findByText('Ajoute Impera dans ton application');
    expect(calls).toEqual(['/v1/auth/two-factor/enable {"password":"staple battery horse"}']);
    // Served once, then forgotten.
    expect(chosenPassword()).toBeNull();
  });

  it('asks for the password after all when the one kept is refused, and forgets a stale one', async () => {
    serve({
      '/v1/auth/two-factor/enable': () => refusal('password_unauthenticated', 401),
    });
    holdChosenPassword('autre chose');
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    holdChosenPassword('vieux', 0);
    expect(chosenPassword(2 * 60_000 + 1)).toBeNull();
  });

  it('says a wrong password, and a wrong first code, in words', async () => {
    let enable = () => refusal('password_missing_forbidden', 403);
    serve({
      '/v1/auth/two-factor/enable': () => enable(),
      '/v1/auth/two-factor/verify-totp': () =>
        json(
          { error: { code: 'second_factor_unauthenticated', message: 'x', details: {}, requestId: 'r' } },
          401,
        ),
    });
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    const password = await screen.findByLabelText('Mot de passe');
    enable = () => refusal('password_unauthenticated', 401);
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

  it('selects the key and says so when the browser refuses the copy, then gives the label back', async () => {
    serve({ '/v1/auth/two-factor/enable': () => json({ totpURI: URI, backupCodes: BACKUP_CODES }) });
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.reject(new Error('refusé')) } });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
      await start();
      fireEvent.click(screen.getByRole('button', { name: 'Copier la clé' }));
      expect(await screen.findByRole('button', { name: 'Sélectionné : copie-le à la main' })).toBeDefined();
      expect(window.getSelection()?.toString()).toBe(keyOf(URI));
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await screen.findByRole('button', { name: 'Copier la clé' })).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves the focus to the title of each new step', async () => {
    serve({ '/v1/auth/two-factor/enable': () => json({ totpURI: URI, backupCodes: BACKUP_CODES }) });
    render(<SecondFactorPage onActivated={() => undefined} onSignOut={() => undefined} />);
    await start();
    expect(document.activeElement?.textContent).toBe('Ajoute Impera dans ton application');
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
