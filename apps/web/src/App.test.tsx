// @vitest-environment jsdom
import type { Me } from '@nirvana/contracts';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { App } from './App';
import { forgetTakenToken } from './auth/api';
import { railOf } from './shell/nav';
import { OWNER } from './test/pay';

/** A fake `/v1/me` that answers each status in turn, the last one for good. */
function serveMe(...statuses: number[]): ReturnType<typeof vi.fn> {
  const fake = vi.fn(() => {
    const status = statuses.length > 1 ? (statuses.shift() ?? 401) : (statuses[0] ?? 401);
    return Promise.resolve(new Response('{}', { status }));
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
    expect(screen.getByRole('status', { name: 'Chargement de Nirvana' })).toBeDefined();
  });

  it('asks to sign in only when the server says there is no session', async () => {
    serveMe(401);
    render(<App />);
    expect(await screen.findByLabelText('Mot de passe')).toBeDefined();
  });

  it('forgets what the device kept of Nirvana when there is no session (a 401, a sign-out made elsewhere)', async () => {
    const deleted: string[] = [];
    vi.stubGlobal('caches', {
      keys: () => Promise.resolve(['nirvana-shell-v1', 'nirvana-assets-v1']),
      delete: (key: string) => {
        deleted.push(key);
        return Promise.resolve(true);
      },
    });
    serveMe(401);
    render(<App />);
    await screen.findByLabelText('Mot de passe');
    expect(deleted).toEqual(['nirvana-shell-v1', 'nirvana-assets-v1']);
  });

  it('says the server does not answer instead of asking to sign in, and asks again on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetch = serveMe(502, 502, 502, 401);
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

  it('says the same when the request does not even reach the server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    render(<App />);
    expect(await screen.findByText('ne répond pas')).toBeDefined();
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

  function serveLink(): Mock<(url: string) => Promise<Response>> {
    const fake = vi.fn((url: string) => {
      if (url.endsWith('/inspect')) return Promise.resolve(Response.json(preview));
      if (url.endsWith('/redeem')) return Promise.resolve(Response.json(theo));
      if (url === '/v1/me') return Promise.resolve(Response.json(theo));
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
        '/v1/me',
      ]);
    });
  });

  it('opens the new password page on its own address', async () => {
    serveLink();
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
      expect(fake.mock.calls.filter(([url]) => url === '/v1/me')).toHaveLength(2);
    });
    expect(window.location.pathname).toBe(railOf(theo).home);
    expect(screen.queryByRole('heading', { name: 'Bienvenue, Théo' })).toBeNull();
  });

  it('leads a link that does not work to the sign-in page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/v1/me'
            ? new Response('{}', { status: 401 })
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

describe('App signing out', () => {
  const owner: Me = {
    id: 'u1',
    email: 'owner@example.test',
    name: 'Nora',
    role: 'owner',
    creatorIds: [],
    routedCreatorIds: [],
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
        if (input === '/v1/me') return Promise.resolve(new Response(JSON.stringify(owner), { status: 200 }));
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

describe('App on the screens of a contractor’s file', () => {
  const member = (role: 'chatter' | 'manager'): Me => ({
    id: `u-${role}`,
    email: `${role}@example.test`,
    name: role === 'chatter' ? 'Théo' : 'Iris',
    role: 'operator',
    creatorIds: [],
    routedCreatorIds: [],
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
        input === '/v1/me'
          ? Promise.resolve(Response.json(me))
          : // The screens stay on their loading state: only where each address leads is under test.
            new Promise<Response>(() => undefined),
      ),
    );
  }

  it('leads Moi to its file, and a chatter’s own invoices to Commissions, where he reads them', async () => {
    serveAs(member('chatter'));
    window.history.replaceState(null, '', '/moi');
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dossier' })).toBeDefined();
    expect(window.location.pathname).toBe('/moi/dossier');
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
});
