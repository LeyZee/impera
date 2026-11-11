// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { App } from './App';
import { forgetTakenToken } from './auth/api';
import { railOf } from './shell/nav';
import { OWNER } from './test/pay';

const SIGNED_OUT = 'signed out';

/** A fake `/v1/session` that answers each in turn, the last one for good: no session, or a failing status. */
function serveMe(...answers: (typeof SIGNED_OUT | number)[]): ReturnType<typeof vi.fn> {
  const fake = vi.fn(() => {
    const answer = answers.length > 1 ? (answers.shift() ?? SIGNED_OUT) : (answers[0] ?? SIGNED_OUT);
    return Promise.resolve(
      answer === SIGNED_OUT ? Response.json({ state: 'signed_out' }) : new Response('{}', { status: answer }),
    );
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  forgetTakenToken();
  window.history.replaceState(null, '', '/');
});

describe('App before any session', () => {
  it('shows it is loading while the session is read', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    render(<App />);
    expect(screen.getByRole('status', { name: 'Chargement d’Impera' })).toBeDefined();
  });

  it('asks to sign in only when the server says there is no session', async () => {
    serveMe(SIGNED_OUT);
    render(<App />);
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
  });

  it('forgets what the device kept of Impera when there is no session (a sign-out made elsewhere)', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['impera-shell-v1', 'impera-assets-v1']),
      delete: (key: string) => {
        deleted.push(key);
        return Promise.resolve(true);
      },
    });
    serveMe(SIGNED_OUT);
    render(<App />);
    await screen.findByLabelText('Mot de passe');
    expect(deleted).toEqual(['impera-shell-v1', 'impera-assets-v1']);
  });

  it('says the server does not answer instead of asking to sign in, and asks again on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serveMe(502, 502, 502, SIGNED_OUT);
    render(<App />);
    expect(await screen.findByText('ne répond pas')).toBeDefined();
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();

    // Quickly at first (a local server still starting), then every 30 s: 3 s, 10 s, 30 s.
    const after = async (ms: number): Promise<void> => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    };
    await after(2_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    await after(1_500);
    expect(fetch).toHaveBeenCalledTimes(2);
    await after(9_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    await after(1_500);
    expect(fetch).toHaveBeenCalledTimes(3);
    await after(28_000);
    expect(fetch).toHaveBeenCalledTimes(3);
    await after(3_000);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
  });

  it('says the API failed, not that it is silent, when it answers its own error (EXT-12)', async () => {
    serveMe(500);
    render(<App />);
    expect(await screen.findByText('un problème')).toBeDefined();
    expect(screen.queryByText('ne répond pas')).toBeNull();
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
  });

  it('says the same when the request does not even reach the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    render(<App />);
    expect(await screen.findByText('ne répond pas')).toBeDefined();
  });
});

describe('App without a network (CREA-04)', () => {
  const nora: Me = {
    id: 'u-nora',
    email: 'nora@example.test',
    name: 'Nora Exemple',
    role: 'creator',
    creatorIds: ['01936f00-0000-7000-8000-0000000000aa'],
    routedCreatorIds: [],
    shiftCreatorIds: [],
    team: null,
    teamScope: 'self',
  };
  const offline = (): void => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
  };

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('opens her app on what her phone kept, never on « Le serveur ne répond pas »', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    localStorage.setItem('impera.session.me', JSON.stringify(nora));
    offline();
    render(<App />);
    expect(await screen.findByRole('button', { name: /Nora/u })).toBeDefined();
    expect(screen.queryByText('ne répond pas')).toBeNull();
    // Out of her agenda, a pill says it and takes her there: what stays readable.
    const pill = await screen.findByText('Hors ligne : ton agenda reste consultable.');
    // Said in a region that was there before it: a screen reader announces it.
    expect(pill.closest('[role="status"]')?.className).toBe('nv-offline-region');
    expect(screen.getByRole('link', { name: 'Ouvrir l’agenda' }).getAttribute('href')).toBe('/agenda');
  });

  it('says there is no network, not that the server is silent, with nothing kept', async () => {
    offline();
    render(<App />);
    expect(await screen.findByText('réseau')).toBeDefined();
    expect(screen.queryByText('ne répond pas')).toBeNull();
  });

  it('keeps no session but a creator’s', async () => {
    localStorage.setItem('impera.session.me', JSON.stringify({ ...nora, role: 'owner', teamScope: 'owner' }));
    offline();
    render(<App />);
    expect(await screen.findByText('réseau')).toBeDefined();
  });
});

describe('App on an invitation link', () => {
  const TOKEN = 'lien-invente-pour-les-tests';
  const theo: Me = {
    id: 'u-theo',
    email: 'theo@example.test',
    name: 'Théo',
    role: 'operator',
    creatorIds: [],
    routedCreatorIds: [],
    shiftCreatorIds: [],
    team: { role: 'chatter', status: 'active' },
    teamScope: 'self',
  };
  const preview = {
    purpose: 'invitation',
    account: 'member',
    email: theo.email,
    displayName: 'Théo',
    country: 'BJ',
    expiresAt: '2026-10-30T15:00:00.000Z',
  };

  function serveLink(
    purpose: 'invitation' | 'reset' = 'invitation',
  ): Mock<(url: string) => Promise<Response>> {
    const fake = vi.fn((url: string) => {
      if (url.endsWith('/inspect')) return Promise.resolve(Response.json({ ...preview, purpose }));
      if (url.endsWith('/redeem')) return Promise.resolve(Response.json(theo));
      if (url === '/v1/session') return Promise.resolve(Response.json({ state: 'signed_in', me: theo }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fake);
    return fake;
  }

  it('opens the link page first, signed in or not: the session is read once, by the page, only to warn', async () => {
    const fake = serveLink();
    window.history.replaceState(null, '', `/bienvenue#t=${TOKEN}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Bienvenue, Théo' })).toBeDefined();
    await vi.waitFor(() => {
      expect(fake.mock.calls.map(([url]) => url).toSorted()).toEqual([
        '/v1/invitation-links/inspect',
        '/v1/session',
      ]);
    });
  });

  it('opens the new password page on its own address', async () => {
    serveLink('reset');
    window.history.replaceState(null, '', `/nouveau-mot-de-passe#t=${TOKEN}`);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Nouveau mot de passe' })).toBeDefined();
  });

  it('reads the new session after the link is used, and lands on the member’s first screen', async () => {
    const fake = serveLink();
    window.history.replaceState(null, '', `/bienvenue#t=${TOKEN}`);
    render(<App />);
    await screen.findByRole('heading', { name: 'Bienvenue, Théo' });
    fireEvent.change(screen.getByLabelText('Mot de passe'), {
      target: { value: 'une phrase que je retiens' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Entrer' }));
    // The page read the session once to warn; the app reads the new one after redeem.
    await vi.waitFor(() => {
      expect(fake.mock.calls.filter(([url]) => url === '/v1/session')).toHaveLength(2);
    });
    expect(window.location.pathname).toBe(railOf(theo).home);
    expect(screen.queryByRole('heading', { name: 'Bienvenue, Théo' })).toBeNull();
  });

  it('leads a link that does not work to the sign-in page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/v1/session'
            ? Response.json({ state: 'signed_out' })
            : Response.json(
                {
                  error: { code: 'invitation_link_not_found', message: 'Lien', details: {}, requestId: 'r1' },
                },
                { status: 404 },
              ),
        ),
      ),
    );
    window.history.replaceState(null, '', `/bienvenue#t=${TOKEN}`);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Aller à la connexion' }));
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
    expect(window.location.pathname).toBe('/');
  });
});

describe('App and a forgotten password (SEC-05 lot 3)', () => {
  it('opens its page on its own address, and says on the sign-in page that the password is changed', async () => {
    const fake = vi.fn((url: string) =>
      Promise.resolve(
        url === '/v1/session'
          ? Response.json({ state: 'signed_out' })
          : url.endsWith('/inspect')
            ? Response.json({ email: 'theo@example.test', expiresAt: '2026-11-06T15:40:00.000Z' })
            : new Response(null, { status: 204 }),
      ),
    );
    vi.stubGlobal('fetch', fake);
    window.history.replaceState(null, '', '/mot-de-passe-oublie#t=lien-invente-pour-les-tests');
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Nouveau mot de passe'), {
      target: { value: 'une phrase que je retiens' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(
      await screen.findByText(
        (_, node) =>
          node?.getAttribute('role') === 'status' &&
          node.textContent === 'Mot de passe changé, connecte-toi. Ton code à 6\u00a0chiffres reste demandé.',
      ),
    ).toBeDefined();
    // The address is filled in, and the password is asked first.
    expect(screen.getByLabelText('E-mail')).toHaveProperty('value', 'theo@example.test');
    expect(document.activeElement).toBe(screen.getByLabelText('Mot de passe'));
    expect(window.location.pathname).toBe('/');
  });

  it('opens the request form without a link, and goes back to the sign-in page without a word', async () => {
    serveMe(SIGNED_OUT);
    window.history.replaceState(null, '', '/mot-de-passe-oublie');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retour à la connexion' }));
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('App signing out', () => {
  const owner: Me = {
    id: 'u1',
    email: 'owner@example.test',
    name: 'Nora',
    role: 'owner',
    creatorIds: [],
    routedCreatorIds: [],
    shiftCreatorIds: [],
    team: null,
    teamScope: 'owner',
  };

  it('says a sign-out the server did not make, instead of doing nothing (recette 28/10, G9)', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    let signOutStatus = 500;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/v1/session') return Promise.resolve(Response.json({ state: 'signed_in', me: owner }));
        if (input === '/v1/auth/sign-out')
          return Promise.resolve(new Response('{}', { status: signOutStatus }));
        // The screens stay on their loading state: only the way out is under test.
        return new Promise<Response>(() => undefined);
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Nora/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect((await screen.findByRole('alert')).textContent).toBe('La déconnexion n’a pas abouti : réessaie.');

    // Tried again and made: the alert goes with the session.
    signOutStatus = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('App when the session ends while it is open (recette 05/11, SEC-01)', () => {
  const owner: Me = {
    id: 'u1',
    email: 'owner@example.test',
    name: 'Nora',
    role: 'owner',
    creatorIds: [],
    routedCreatorIds: [],
    shiftCreatorIds: [],
    team: null,
    teamScope: 'owner',
  };
  const gone = () =>
    Response.json(
      {
        error: { code: 'session_unauthenticated', message: 'Connexion requise', details: {}, requestId: 'r' },
      },
      { status: 401 },
    );

  function serveSession(session: () => Promise<Response>, screens: () => Promise<Response>): Mock {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const fake = vi.fn((input: string) => (input === '/v1/session' ? session() : screens()));
    vi.stubGlobal('fetch', fake);
    return fake;
  }

  it('goes back to the sign-in page at the first 401 of a screen, says why, and forgets the device', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['impera-shell-v1']),
      delete: (key: string) => {
        deleted.push(key);
        return Promise.resolve(true);
      },
    });
    let isOpen = true;
    // The screens wait until the session is closed elsewhere, then every call answers 401.
    let close: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const fake = serveSession(
      () =>
        Promise.resolve(Response.json(isOpen ? { state: 'signed_in', me: owner } : { state: 'signed_out' })),
      () => closed.then(gone),
    );
    render(<App />);
    await screen.findByRole('button', { name: /Nora/u });
    isOpen = false;
    close();
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe(
      'Ta session a pris fin. Reconnecte-toi pour continuer.',
    );
    expect(deleted).toEqual(['impera-shell-v1']);
    // Many screens answered 401 at once: the session was read again once, not once per answer, and no more.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.mock.calls.filter(([url]) => url === '/v1/session').length).toBeLessThanOrEqual(3);
    // Signed out, the app no longer watches the answers: fetch is the browser's again.
    expect(window.fetch === fake).toBe(true);
  });

  it('stays on the screen when the session is still open, or cannot be read', async () => {
    let session = () => Promise.resolve(Response.json({ state: 'signed_in', me: owner }));
    serveSession(
      () => session(),
      () => Promise.resolve(gone()),
    );
    render(<App />);
    await screen.findByRole('button', { name: /Nora/u });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    // Offline: the agenda kept on the device stays readable, the screens say the network their own way.
    session = () => Promise.reject(new TypeError('Failed to fetch'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByLabelText('Mot de passe')).toBeNull();
    expect(screen.getByRole('button', { name: /Nora/u })).toBeDefined();
  });

  it('does not take a sign-out she asked for as a session that ended (relecture #538)', async () => {
    let isOpen = true;
    let close: () => void = () => undefined;
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        if (input === '/v1/session') {
          return Promise.resolve(
            Response.json(isOpen ? { state: 'signed_in', me: owner } : { state: 'signed_out' }),
          );
        }
        if (input === '/v1/auth/sign-out') {
          isOpen = false;
          close();
          return Promise.resolve(Response.json({}));
        }
        // A screen's read in flight: it gets its 401 once the session is gone.
        return closed.then(gone);
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Nora/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Ta session a pris fin. Reconnecte-toi pour continuer.')).toBeNull();
  });

  it('reads the session again when the app is shown again, and signs out a session that expired meanwhile', async () => {
    let isOpen = true;
    serveSession(
      () =>
        Promise.resolve(Response.json(isOpen ? { state: 'signed_in', me: owner } : { state: 'signed_out' })),
      () => new Promise<Response>(() => undefined),
    );
    render(<App />);
    await screen.findByRole('button', { name: /Nora/u });
    isOpen = false;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByText('Ta session a pris fin. Reconnecte-toi pour continuer.')).toBeDefined();
  });
});

describe('App on the screens of a contractor’s file', () => {
  const member = (role: 'chatter' | 'manager'): Me => ({
    id: `u-${role}`,
    email: `${role}@example.test`,
    name: role === 'chatter' ? 'Théo' : 'Iris',
    role: 'operator',
    creatorIds: [],
    routedCreatorIds: [],
    shiftCreatorIds: [],
    team: { role, status: 'active' },
    teamScope: role === 'chatter' ? 'self' : 'agency',
  });

  function serveAs(me: Me): void {
    vi.stubGlobal('scrollTo', vi.fn());
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input === '/v1/session'
          ? Promise.resolve(Response.json({ state: 'signed_in', me }))
          : // The screens stay on their loading state: only where each address leads is under test.
            new Promise<Response>(() => undefined),
      ),
    );
  }

  it('leads Moi to his profile (CHAT-30), and a chatter’s own invoices to Commissions, where he reads them', async () => {
    serveAs(member('chatter'));
    window.history.replaceState(null, '', '/moi');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Profil' })).toBeDefined();
    expect(window.location.pathname).toBe('/moi/profil');
    cleanup();
    window.history.replaceState(null, '', '/moi/factures');
    render(<App />);
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe('/commissions/factures');
    });
  });

  it('gives a manager his own invoices in Moi, and keeps a member’s file to the owner', async () => {
    serveAs(member('manager'));
    window.history.replaceState(null, '', '/moi/factures');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Factures' })).toBeDefined();
    expect(window.location.pathname).toBe('/moi/factures');
    cleanup();
    window.history.replaceState(null, '', '/equipe/membres/0199f2a0-0000-7000-8000-000000000021/dossier');
    render(<App />);
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe('/equipe/membres');
    });
  });

  it('keeps Paie › Exports to the owner: a manager has no tab, and its address leads him to Paie', async () => {
    serveAs(member('manager'));
    window.history.replaceState(null, '', '/paie/exports');
    render(<App />);
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe('/paie/quinzaine');
    });
    expect(await screen.findByRole('link', { name: 'Factures' })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Exports' })).toBeNull();
    cleanup();
    serveAs(OWNER);
    window.history.replaceState(null, '', '/paie/exports');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Exports' })).toBeDefined();
    expect(screen.getByRole('link', { name: 'Exports' }).getAttribute('href')).toBe('/paie/exports');
    expect(window.location.pathname).toBe('/paie/exports');
  });

  it('keeps « Reconnecter Reveal » to the owner, like the extension’s « Sync » (P2-01)', async () => {
    serveAs(member('manager'));
    window.history.replaceState(null, '', '/aide/reveal');
    render(<App />);
    await vi.waitFor(() => {
      expect(window.location.pathname).not.toBe('/aide/reveal');
    });
    expect(screen.queryByRole('heading', { name: 'Reconnecter Reveal' })).toBeNull();
    cleanup();
    serveAs(OWNER);
    window.history.replaceState(null, '', '/aide/reveal');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Reconnecter Reveal' })).toBeDefined();
    expect(screen.getByText(/membre d’équipe « bot »/u)).toBeDefined();
  });

  it('keeps the extension’s guide to the team: a creator who opens its address is sent home (CREA-13)', async () => {
    serveAs({
      ...member('chatter'),
      id: 'u-creator',
      name: 'Lou',
      role: 'creator',
      team: null,
      teamScope: 'self',
    });
    window.history.replaceState(null, '', '/aide/extension');
    render(<App />);
    await vi.waitFor(() => {
      expect(window.location.pathname).toBe('/aujourdhui');
    });
    expect(screen.queryByRole('heading', { name: 'Installer l’extension' })).toBeNull();
    cleanup();
    serveAs(member('chatter'));
    window.history.replaceState(null, '', '/aide/extension');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Installer l’extension' })).toBeDefined();
  });
});
