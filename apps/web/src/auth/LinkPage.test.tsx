// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewPasswordPage } from './NewPasswordPage';
import { WelcomePage } from './WelcomePage';
import { forgetTakenToken } from './api';

const TOKEN = 'lien-invente-pour-les-tests';
const PASSWORD = 'une phrase que je retiens';

const ME = {
  id: 'u-theo',
  email: 'theo@example.test',
  name: 'Théo',
  role: 'operator',
  creatorIds: [],
  routedCreatorIds: [],
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};

function preview(purpose: 'invitation' | 'reset') {
  return {
    purpose,
    email: 'theo@example.test',
    displayName: 'Théo',
    country: 'BJ',
    expiresAt: '2026-10-30T15:00:00.000Z',
  };
}

function refusal(code: string, details: Record<string, unknown> = {}) {
  return { error: { code, message: 'Refusé', details, requestId: 'r1' } };
}

type Answer = readonly [number, unknown] | 'offline';

/**
 * The two routes; each answers its turns in order, the last one for good. `/v1/me` answers `me`, no session (401)
 * unless told otherwise.
 */
function serve(routes: { inspect?: Answer[]; redeem?: Answer[]; me?: Answer }) {
  const fake = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url) => {
    if (url === '/v1/me') {
      const me = routes.me ?? ([401, {}] as const);
      if (me === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(JSON.stringify(me[1]), { status: me[0] }));
    }
    const turns = (url.endsWith('/inspect') ? routes.inspect : routes.redeem) ?? [];
    const next = turns.length > 1 ? turns.shift() : turns[0];
    if (next === undefined) return Promise.resolve(new Response('{}', { status: 500 }));
    if (next === 'offline') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(new Response(JSON.stringify(next[1]), { status: next[0] }));
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

/** The calls of a route, url and body. */
function callsTo(fake: ReturnType<typeof serve>, route: 'inspect' | 'redeem') {
  return fake.mock.calls
    .map(([url, init]) => ({ url, body: init?.body }))
    .filter(({ url }) => url.endsWith(`/${route}`));
}

function open(page: 'welcome' | 'reset', hash = `#t=${TOKEN}`) {
  const path = page === 'welcome' ? '/bienvenue' : '/nouveau-mot-de-passe';
  window.history.replaceState(null, '', `${path}${hash}`);
  const onSignedIn = vi.fn();
  const onLeave = vi.fn();
  const Page = page === 'welcome' ? WelcomePage : NewPasswordPage;
  render(<Page onSignedIn={onSignedIn} onLeave={onLeave} />);
  return { onSignedIn, onLeave };
}

function choosePassword(value: string): void {
  fireEvent.change(screen.getByLabelText(/^(Nouveau m|M)ot de passe$/u), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  forgetTakenToken();
  window.history.replaceState(null, '', '/');
});

describe('the token', () => {
  it('leaves the address before any call, and travels only in the POST bodies', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    const fake = serve({ inspect: [[200, preview('invitation')]], redeem: [[200, ME]] });
    open('welcome');
    // Taken out on the first render, before the page asks the server anything.
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/bienvenue');
    const cleaned = replace.mock.invocationCallOrder.at(-1) ?? Infinity;
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    expect(fake.mock.invocationCallOrder[0]).toBeGreaterThan(cleaned);

    choosePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
    await vi.waitFor(() => {
      expect(callsTo(fake, 'redeem')).toHaveLength(1);
    });
    expect(callsTo(fake, 'inspect')).toEqual([
      { url: '/v1/invitation-links/inspect', body: JSON.stringify({ token: TOKEN }) },
    ]);
    expect(callsTo(fake, 'redeem')).toEqual([
      { url: '/v1/invitation-links/redeem', body: JSON.stringify({ token: TOKEN, password: PASSWORD }) },
    ]);
    for (const [url] of fake.mock.calls) expect(url).not.toContain(TOKEN);
    replace.mockRestore();
  });

  it('asks nothing of the server for a cut link, which is one more link that does not work', () => {
    const fake = serve({});
    open('welcome', '');
    expect(screen.getByText('Ce lien ne marche plus')).toBeDefined();
    expect(fake).not.toHaveBeenCalled();
  });

  it('sends no Referer while the page is open', async () => {
    serve({ inspect: [[200, preview('invitation')]] });
    open('welcome');
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    expect(document.head.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    cleanup();
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });
});

describe('WelcomePage', () => {
  it('welcomes the member by name, his e-mail read only, then opens his session', async () => {
    serve({ inspect: [[200, preview('invitation')]], redeem: [[200, ME]] });
    const { onSignedIn } = open('welcome');

    expect(await screen.findByRole('heading', { name: 'Bienvenue, Théo' })).toBeDefined();
    // His record, to check at a glance: his name in the title, his country above it.
    expect(screen.getByText('🇧🇯 Bénin')).toBeDefined();
    expect(screen.getByText(/Dis-le à ton responsable/u)).toBeDefined();
    const email = screen.getByLabelText('E-mail');
    expect(email).toHaveProperty('value', 'theo@example.test');
    expect(email).toHaveProperty('readOnly', true);
    expect(email.getAttribute('autocomplete')).toBe('username');
    expect(screen.getByLabelText('Mot de passe').getAttribute('autocomplete')).toBe('new-password');

    choosePassword(PASSWORD);
    const enter = screen.getByRole('button', { name: 'Entrer' });
    fireEvent.click(enter);
    // Busy while it sends: a second tap sends nothing.
    expect(screen.getByRole('button', { name: 'Un instant…' })).toHaveProperty('disabled', true);
    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(ME);
    });
  });

  it('says the length before sending, and sends nothing too short', async () => {
    const fake = serve({ inspect: [[200, preview('invitation')]] });
    open('welcome');
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    expect(screen.getByText(/12 caractères au moins \(encore 12\)/u)).toBeDefined();

    choosePassword('court');
    expect(screen.getByText(/encore 7/u)).toBeDefined();
    const enter = screen.getByRole('button', { name: 'Entrer' });
    expect(enter).toHaveProperty('disabled', true);
    fireEvent.submit(enter.closest('form') ?? enter);
    expect(callsTo(fake, 'redeem')).toHaveLength(0);

    choosePassword(PASSWORD);
    expect(screen.getByText('C’est bon.')).toBeDefined();
    expect(enter).toHaveProperty('disabled', false);
  });

  it('shows the password on demand, for a phone keyboard', async () => {
    serve({ inspect: [[200, preview('invitation')]] });
    open('welcome');
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    const toggle = screen.getByRole('button', { name: 'Afficher' });
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Mot de passe').getAttribute('type')).toBe('text');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.textContent).toBe('Masquer');
  });

  it('says a refused link in one state, without the reason, and leads to the sign-in page', async () => {
    serve({ inspect: [[404, refusal('invitation_link_not_found')]] });
    const { onLeave } = open('welcome');
    expect(await screen.findByText('Ce lien ne marche plus')).toBeDefined();
    expect(screen.getByText('Demande un nouveau lien à ton responsable.')).toBeDefined();
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aller à la connexion' }));
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('turns to the same state when the link was used in between', async () => {
    serve({
      inspect: [[200, preview('invitation')]],
      redeem: [[404, refusal('invitation_link_not_found')]],
    });
    open('welcome');
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    choosePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
    expect(await screen.findByText('Ce lien ne marche plus')).toBeDefined();
  });

  it('says the server does not answer, and reads the link again on « Réessayer »', async () => {
    const fake = serve({ inspect: ['offline', [200, preview('invitation')]] });
    open('welcome');
    expect(await screen.findByText('Le serveur ne répond pas')).toBeDefined();
    // Reading a link never uses it; whether it still works, the page cannot know yet.
    expect(screen.getByText('Ton lien n’a pas servi. Réessaie dans un instant.')).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
      await Promise.resolve();
    });
    expect(await screen.findByRole('heading', { name: 'Bienvenue, Théo' })).toBeDefined();
    // The token stayed in the page: the second read sends it the same way.
    expect(callsTo(fake, 'inspect').map(({ body }) => body)).toEqual([
      JSON.stringify({ token: TOKEN }),
      JSON.stringify({ token: TOKEN }),
    ]);
  });
});

describe('an answer lost after the link was used', () => {
  it('says the password is most likely saved, rather than asking for a new link', async () => {
    serve({
      inspect: [[200, preview('invitation')]],
      redeem: ['offline', [404, refusal('invitation_link_not_found')]],
    });
    const { onLeave } = open('welcome');
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    choosePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
    expect(await screen.findByText(/Le serveur ne répond pas/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Ce lien a déjà servi')).toBeDefined();
    expect(screen.getByText(/connecte-toi avec lui/u)).toBeDefined();
    expect(screen.queryByText('Demande un nouveau lien à ton responsable.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Aller à la connexion' }));
    expect(onLeave).toHaveBeenCalledOnce();
  });
});

describe('another account signed in on this browser', () => {
  const CHARLES = {
    ...ME,
    id: 'u-owner',
    email: 'proprietaire@example.test',
    name: 'Charles',
    role: 'owner',
  };
  // No « de » before a name, which would need « d’ » before Alex or Inès (NAV-15).
  const WARNING =
    /Ce navigateur est ouvert sur le compte Charles\. « Entrer » ouvrira à sa place le compte Théo\./u;

  it('says the member’s session will take its place, before he enters', async () => {
    serve({
      inspect: [[200, preview('invitation')]],
      me: [200, { ...CHARLES, team: null, teamScope: 'owner' }],
    });
    open('welcome');
    // The page's title in the body's face, the name in the rail's (NAV-14), and the tab named after the page (NAV-12).
    const title = await screen.findByRole('heading', { level: 1, name: 'Bienvenue, Théo' });
    expect(title.className).not.toContain('font-serif');
    expect(screen.getByText('Nirvana').className).toContain('nv-wordmark');
    expect(document.title).toBe('Bienvenue · Nirvana');
    expect(await screen.findByText(WARNING)).toBeDefined();
  });

  it('says it with the button of the page, on a new password link', async () => {
    serve({ inspect: [[200, preview('reset')]], me: [200, { ...CHARLES, team: null, teamScope: 'owner' }] });
    open('reset');
    expect(await screen.findByText(/« Enregistrer » ouvrira à sa place le compte Théo\./u)).toBeDefined();
  });

  it('says nothing when it is his own account, when no one is signed in, or when the session cannot be read', async () => {
    for (const me of [[200, { ...ME, email: 'THEO@example.test' }], [401, {}], 'offline'] as const) {
      const fake = serve({ inspect: [[200, preview('invitation')]], me });
      open('welcome');
      await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
      await vi.waitFor(() => {
        expect(fake.mock.calls.map(([url]) => url)).toContain('/v1/me');
      });
      expect(screen.queryByText(/Ce navigateur est connecté/u)).toBeNull();
      cleanup();
      forgetTakenToken();
    }
  });
});

describe('NewPasswordPage', () => {
  it('opens the session as soon as the new password is set', async () => {
    serve({ inspect: [[200, preview('reset')]], redeem: [[200, ME]] });
    const { onSignedIn } = open('reset');
    expect(await screen.findByRole('heading', { name: 'Nouveau mot de passe' })).toBeDefined();
    expect(screen.getByText(/Tes autres appareils seront déconnectés/u)).toBeDefined();
    choosePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(ME);
    });
  });

  it('says in words why a password is refused, and lets the member try another', async () => {
    serve({
      inspect: [[200, preview('reset')]],
      redeem: [[400, refusal('password_invalid', { reason: 'refused' })]],
    });
    const { onSignedIn } = open('reset');
    await screen.findByRole('heading', { name: 'Nouveau mot de passe' });
    choosePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Ce mot de passe est refusé. Choisis-en un autre.')).toBeDefined();
    expect(screen.getByLabelText('Nouveau mot de passe').getAttribute('aria-invalid')).toBe('true');
    expect(onSignedIn).not.toHaveBeenCalled();
    // Typing again clears the refusal: the next try starts clean.
    choosePassword(`${PASSWORD} bis`);
    expect(screen.queryByText(/Ce mot de passe est refusé/u)).toBeNull();
  });

  it('keeps the form when the server does not answer, and the button retries', async () => {
    const fake = serve({ inspect: [[200, preview('reset')]], redeem: ['offline', [200, ME]] });
    const { onSignedIn } = open('reset');
    await screen.findByRole('heading', { name: 'Nouveau mot de passe' });
    choosePassword(PASSWORD);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/Le serveur ne répond pas/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(ME);
    });
    expect(callsTo(fake, 'redeem')).toHaveLength(2);
  });
});
