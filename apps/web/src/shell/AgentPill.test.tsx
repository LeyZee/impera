// @vitest-environment jsdom
import type { AgentMode } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentPill } from './AgentPill';

import { apiDashboard, CREATOR, serveDashboard } from '@/test/fakes';

async function renderPill(): Promise<HTMLElement> {
  const root = createRootRoute({
    component: (): JSX.Element => (
      <>
        <AgentPill />
        <Outlet />
      </>
    ),
  });
  const routes = ['/', '/suivi'].map((path) => createRoute({ getParentRoute: () => root, path }));
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: ['/suivi'] }),
  });
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return screen.findByRole('link');
}

const live = (mode: AgentMode) => ({ status: 200, body: apiDashboard({ mode }) });

beforeEach(() => {
  // The router restores the scroll on each navigation; jsdom has no layout to scroll.
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentPill', () => {
  it('says nothing about the mode until the server answers, and « Agent » once (NAV-05)', async () => {
    serveDashboard(live('copilot'));
    const pill = await renderPill();
    // The pill writes « Agent » itself (CSS): while it waits, a dot and an ellipsis, never « Agent ● Agent ».
    expect(pill.textContent).toBe('…');
    expect(pill.getAttribute('aria-label')).toBe('Agent : lecture en cours.');
  });

  it('says the server’s mode and opens the Dashboard', async () => {
    serveDashboard(live('copilot'));
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Copilote');
    });
    expect(pill.getAttribute('href')).toBe('/');
    expect(pill.dataset['tone']).toBe('ok');
  });

  it('keeps the mode but no live green dot when nothing runs, and says why', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        reveal: { connected: false, lastReadAt: null, late: false, conversations: 0 },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Copilote');
    });
    expect(pill.dataset['tone']).toBe('unknown');
    expect(pill.querySelector('.nv-dot--live')).toBeNull();
    expect(pill.title).toBe(
      'Agent : Copilote, mais rien ne tourne : Reveal n’est pas encore relié. Voir le Dashboard.',
    );
  });

  it('says a session that read then dropped is disconnected, not « not linked yet »', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        reveal: { connected: false, lastReadAt: '2026-10-19T11:00:00Z', late: false, conversations: 0 },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.title).toBe(
        'Agent : Copilote, mais rien ne tourne : Reveal est déconnecté. Voir le Dashboard.',
      );
    });
    expect(pill.dataset['tone']).toBe('unknown');
  });

  it('says the voice waits for its key, not that it is down', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.title).toBe(
        'Agent : Copilote, mais rien ne tourne : l’IA qui écrit attend sa clé. Voir le Dashboard.',
      );
    });
  });

  it('turns amber, not red, when the server says the agent is stopped (NAV-06)', async () => {
    serveDashboard(live('stop'));
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Arrêt');
    });
    expect(pill.dataset['tone']).toBe('warn');
    expect(pill.querySelector('.nv-tone--warn')).not.toBeNull();
  });

  it('says « Injoignable » when the server does not answer, never the sample’s Copilote', async () => {
    serveDashboard({ status: 500 });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Injoignable');
    });
    expect(pill.dataset['tone']).toBe('unknown');
    expect(pill.getAttribute('title')).toContain('Le serveur ne répond pas');
  });

  it('says « Sans créatrice » before any creator exists, never the sample’s mode', async () => {
    serveDashboard(live('copilot'), []);
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Sans créatrice');
    });
    expect(pill.getAttribute('title')).toContain('Aucune créatrice');
  });

  it('follows the creator chosen on the Dashboard, and names her among several (recette 28/10, G1; DASH-03)', async () => {
    const ana = { id: '0192f3a0-0000-7000-8000-0000000000c2', displayName: 'Ana', timezone: 'Europe/Paris' };
    localStorage.setItem('nirvana.followed-creator', CREATOR.id);
    try {
      // Ana, first of the list, is stopped; Léa, the one chosen, runs.
      serveDashboard(
        (url) => live(url.searchParams.get('creatorId') === ana.id ? 'stop' : 'copilot'),
        [ana, CREATOR],
      );
      const pill = await renderPill();
      await waitFor(() => {
        expect(pill.textContent).toBe('Léa · Copilote');
      });
    } finally {
      localStorage.clear();
    }
  });

  it('names no creator when the account follows only one', async () => {
    serveDashboard(live('copilot'));
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Copilote');
    });
  });

  it('says Reveal is no longer read when the session holds but nothing reads it (recette 28/10, G8)', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        reveal: { connected: true, lastReadAt: '2026-10-19T11:00:00Z', late: true, conversations: 12 },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.title).toBe(
        'Agent : Copilote, mais rien ne tourne : Reveal n’est plus lu depuis plusieurs minutes. Voir le Dashboard.',
      );
    });
    expect(pill.dataset['tone']).toBe('unknown');
  });
});
