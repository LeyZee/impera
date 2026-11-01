// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
});
