// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInPage } from './SignInPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SignInPage', () => {
  it('points a forgotten password to its own page (SEC-05 lot 3)', () => {
    render(<SignInPage onSignedIn={() => undefined} />);
    expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' }).getAttribute('href')).toBe(
      '/mot-de-passe-oublie',
    );
  });

  it('says a new password is saved until the first try, in a calm tone, not as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 401 }))),
    );
    render(
      <SignInPage
        onSignedIn={() => undefined}
        confirmation="Mot de passe changé, connecte-toi. Ton code à 6 chiffres reste demandé."
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Mot de passe changé, connecte-toi. Ton code à 6 chiffres reste demandé.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
    expect(await screen.findByText('E-mail ou mot de passe incorrect.')).toBeDefined();
    expect(screen.queryByText(/Mot de passe changé/u)).toBeNull();
  });

  it('says how long to wait after too many attempts: the window lasts 15 minutes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('{}', { status: 429 }))),
    );
    render(<SignInPage onSignedIn={() => undefined} />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
    expect(await screen.findByText('Trop de tentatives. Réessaie dans un quart d’heure.')).toBeDefined();
  });

  it('asks for the code after a right password, then signs in', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push(`${url} ${typeof init?.body === 'string' ? init.body : ''}`);
        const body = url.endsWith('/sign-in/email') ? { twoFactorRedirect: true } : {};
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    const onSignedIn = vi.fn();
    render(<SignInPage onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
    const code = await screen.findByLabelText('Code à 6 chiffres');
    expect(onSignedIn).not.toHaveBeenCalled();
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByLabelText(/Se souvenir de cet appareil 30 jours/u));
    fireEvent.submit(code.closest('form') ?? document.body);
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalled();
    });
    expect(calls[1]).toBe('/v1/auth/two-factor/verify-totp {"code":"123456","trustDevice":true}');
  });

  it('takes a backup code instead, and says a wrong code plainly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith('/sign-in/email')
            ? new Response(JSON.stringify({ twoFactorRedirect: true }), { status: 200 })
            : new Response(
                JSON.stringify({
                  error: { code: 'second_factor_unauthenticated', message: 'x', details: {}, requestId: 'r' },
                }),
                {
                  status: 401,
                },
              ),
        ),
      ),
    );
    render(<SignInPage onSignedIn={() => undefined} />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Pas ton téléphone ? Utiliser un code de secours' }),
    );
    const code = screen.getByLabelText('Code de secours');
    fireEvent.change(code, { target: { value: 'abcde-fghij' } });
    fireEvent.submit(code.closest('form') ?? document.body);
    // Her phone is not at hand: its clock is beside the point (recette SEC-07).
    expect(
      await screen.findByText(
        'Ce code de secours ne marche pas, ou il a déjà servi. Chacun ne sert qu’une fois.',
      ),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Utiliser le code de l’application' }));
    const digits = screen.getByLabelText('Code à 6 chiffres');
    fireEvent.change(digits, { target: { value: '123456' } });
    fireEvent.submit(digits.closest('form') ?? document.body);
    expect(
      await screen.findByText('Ce code ne marche pas. Vérifie l’heure de ton téléphone et réessaie.'),
    ).toBeDefined();
  });

  it('sends a backup code typed in the app’s field to the backup check', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        calls.push(url);
        const body = url.endsWith('/sign-in/email') ? { twoFactorRedirect: true } : {};
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );
    const onSignedIn = vi.fn();
    render(<SignInPage onSignedIn={onSignedIn} />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
    const code = await screen.findByLabelText('Code à 6 chiffres');
    fireEvent.change(code, { target: { value: 'abcde-fghij' } });
    fireEvent.submit(code.closest('form') ?? document.body);
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalled();
    });
    expect(calls[1]).toBe('/v1/auth/two-factor/verify-backup-code');
  });

  it('goes back to the password when the code step expired', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith('/sign-in/email')
            ? new Response(JSON.stringify({ twoFactorRedirect: true }), { status: 200 })
            : new Response(
                JSON.stringify({
                  error: {
                    code: 'second_factor_challenge_unauthenticated',
                    message: 'x',
                    details: {},
                    requestId: 'r',
                  },
                }),
                { status: 401 },
              ),
        ),
      ),
    );
    render(<SignInPage onSignedIn={() => undefined} />);
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'a@example.test' } });
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Mot de passe').closest('form') ?? document.body);
    const code = await screen.findByLabelText('Code à 6 chiffres');
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.submit(code.closest('form') ?? document.body);
    expect(await screen.findByText('La vérification a expiré. Reconnecte-toi.')).toBeDefined();
    expect(screen.getByLabelText('Mot de passe')).toBeDefined();
  });
});
