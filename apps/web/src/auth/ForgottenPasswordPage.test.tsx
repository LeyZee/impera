// @vitest-environment jsdom
import { PASSWORD_RESET_REQUESTED_MESSAGE } from '@impera/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForgottenPasswordPage, keepUnits } from './ForgottenPasswordPage';
import { forgetTakenToken } from './api';

const TOKEN = 'lien-invente-pour-les-tests';
const PASSWORD = 'une phrase que je retiens';
const PREVIEW = { email: 'theo@example.test', expiresAt: '2026-11-06T15:40:00.000Z' };

function refusal(code: string, details: Record<string, unknown> = {}) {
  return { error: { code, message: 'Refusé', details, requestId: 'r1' } };
}

type Answer = readonly [number, unknown] | 'offline';
type Route = 'request' | 'inspect' | 'redeem';

const routeOf = (url: string): Route =>
  url.endsWith('/inspect') ? 'inspect' : url.endsWith('/redeem') ? 'redeem' : 'request';

/** The three routes; each answers its turns in order, the last one for good. */
function serve(routes: Partial<Record<Route, Answer[]>>) {
  const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
    const turns = routes[routeOf(url)] ?? [];
    const next = turns.length > 1 ? turns.shift() : turns[0];
    if (next === undefined) return Promise.resolve(new Response('{}', { status: 500 }));
    if (next === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    // A 204 has no body.
    return Promise.resolve(
      next[0] === 204 ? new Response(null, { status: 204 }) : Response.json(next[1], { status: next[0] }),
    );
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

function callsTo(fake: ReturnType<typeof serve>, route: Route) {
  return fake.mock.calls
    .filter(([url]) => routeOf(url) === route)
    .map(([url, init]) => {
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      return { url, body };
    });
}

function open(hash = '') {
  window.history.replaceState(null, '', `/mot-de-passe-oublie${hash}`);
  const onLeave = vi.fn();
  const onChanged = vi.fn();
  render(<ForgottenPasswordPage onLeave={onLeave} onChanged={onChanged} />);
  return { onLeave, onChanged };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetTakenToken();
  window.history.replaceState(null, '', '/');
});

describe('« Mot de passe oublié » without a link (SEC-05 lot 3)', () => {
  it('sends the address as typed, checks nothing of it, and shows the server’s one sentence as it is', async () => {
    const fake = serve({ request: [[202, { message: PASSWORD_RESET_REQUESTED_MESSAGE }]] });
    open();
    expect(screen.getByRole('button', { name: 'Envoyer le lien' })).toHaveProperty('disabled', true);
    // Not an address at all: the page says nothing of it, the server answers the same sentence.
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: '  pas-une-adresse ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText(PASSWORD_RESET_REQUESTED_MESSAGE)).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Demande reçue' })).toBeDefined();
    expect(callsTo(fake, 'request')).toEqual([
      { url: '/v1/auth/password-reset', body: { email: 'pas-une-adresse' } },
    ]);
  });

  it('keeps the address to correct it, and goes back to the sign-in page', async () => {
    serve({ request: [[202, { message: PASSWORD_RESET_REQUESTED_MESSAGE }]] });
    const { onLeave } = open();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'theo@exemple.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Corriger l’adresse' }));
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'theo@exemple.test');
    fireEvent.click(screen.getByRole('button', { name: 'Retour à la connexion' }));
    expect(onLeave).toHaveBeenCalled();
  });

  it('says to wait a few minutes after too many requests, and when the server does not answer', async () => {
    serve({ request: [[429, refusal('rate_limited')], 'offline'] });
    open();
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'theo@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(
      await screen.findByText('Trop de demandes d’un coup : réessaie dans quelques minutes.'),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le lien' }));
    expect(await screen.findByText('Le serveur ne répond pas. Réessaie dans un instant.')).toBeDefined();
  });
});

describe('« Mot de passe oublié » with its link (SEC-05 lot 3)', () => {
  it('takes the link out of the address, shows whose it is until when, and saves the new password', async () => {
    const fake = serve({ inspect: [[200, PREVIEW]], redeem: [[204, null]] });
    const { onChanged } = open(`#t=${TOKEN}`);
    expect(window.location.hash).toBe('');
    expect(await screen.findByRole('heading', { name: 'Nouveau mot de passe' })).toBeDefined();
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'theo@example.test');
    const until = new Date(PREVIEW.expiresAt);
    // « 15 h 40 » never breaks: non-breaking spaces.
    const hour = `${String(until.getHours()).padStart(2, '0')}\u00a0h\u00a0${String(until.getMinutes()).padStart(2, '0')}`;
    expect(
      screen.getByText((_, node) => node?.tagName === 'SPAN' && node.textContent === hour),
    ).toBeDefined();

    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('theo@example.test');
    });
    expect(callsTo(fake, 'inspect')).toEqual([
      { url: '/v1/auth/password-reset/inspect', body: { token: TOKEN } },
    ]);
    expect(callsTo(fake, 'redeem')).toEqual([
      { url: '/v1/auth/password-reset/redeem', body: { token: TOKEN, password: PASSWORD } },
    ]);
  });

  it('says a link that does not work any more, and asks a new one from there', async () => {
    serve({ inspect: [[404, refusal('password_reset_link_not_found')]] });
    open(`#t=${TOKEN}`);
    expect(await screen.findByRole('heading', { name: 'Ce lien ne marche plus' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Demander un nouveau lien' }));
    expect(screen.getByRole('heading', { name: 'Mot de passe oublié' })).toBeDefined();
  });

  it('says a cut link does not work, without asking the server', () => {
    const fake = serve({});
    open('#t=');
    expect(screen.getByRole('heading', { name: 'Ce lien ne marche plus' })).toBeDefined();
    expect(fake).not.toHaveBeenCalled();
  });

  it('says why a password is refused, and a link that died meanwhile', async () => {
    serve({
      inspect: [[200, PREVIEW]],
      redeem: [
        [400, refusal('password_invalid', { reason: 'breached' })],
        [404, refusal('password_reset_link_not_found')],
      ],
    });
    open(`#t=${TOKEN}`);
    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), { target: { value: PASSWORD } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      await screen.findByText(
        'Ce mot de passe circule déjà dans des fuites de données connues. Choisis-en un autre.',
      ),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: `${PASSWORD} bis` } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByRole('heading', { name: 'Ce lien ne marche plus' })).toBeDefined();
  });
});

describe('keepUnits', () => {
  it('keeps a number on the line of its unit, in the server\u2019s sentence too', () => {
    expect(keepUnits('Le lien vaut 15 minutes et 6 chiffres.')).toBe(
      'Le lien vaut 15\u00a0minutes et 6\u00a0chiffres.',
    );
    expect(keepUnits('Rien à garder : 2026 - fin.')).toBe('Rien à garder : 2026 - fin.');
  });
});
