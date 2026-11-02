// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignInPage } from './SignInPage';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SignInPage', () => {
  it('points a forgotten password to whoever manages the access, a wording the owner can read too', () => {
    render(<SignInPage onSignedIn={() => undefined} />);
    expect(
      screen.getByText('Mot de passe oublié ? Demande un nouveau lien à la personne qui gère ton accès.'),
    ).toBeDefined();
    expect(screen.queryByText(/ton responsable/u)).toBeNull();
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
    expect(
      await screen.findByText('Ce code ne marche pas. Vérifie l’heure de ton téléphone et réessaie.'),
    ).toBeDefined();
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
