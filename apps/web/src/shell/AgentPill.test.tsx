// @vitest-environment jsdom
import type { AgentMode } from '@impera/contracts';
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
import { RevealCutMark } from './RevealCutMark';

import { apiDashboard, CREATOR, serveDashboard } from '@/test/fakes';

async function renderPill(at = '/suivi'): Promise<HTMLElement> {
  const root = createRootRoute({
    component: (): JSX.Element => (
      <>
        <AgentPill />
        <RevealCutMark />
        <Outlet />
      </>
    ),
  });
  const routes = ['/', '/suivi', '/creatrices'].map((path) =>
    createRoute({ getParentRoute: () => root, path }),
  );
  const router = createRouter({
    routeTree: root.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [at] }),
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
        reveal: { connected: false, lastReadAt: null, late: false, outage: null, conversations: 0 },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Copilote');
    });
    expect(pill.dataset['tone']).toBe('unknown');
    expect(pill.querySelector('.nv-dot--live')).toBeNull();
    expect(pill.title).toBe(
      'Agent : Copilote, mais rien ne tourne : la messagerie Reveal n’est pas encore reliée. Voir le Dashboard.',
    );
  });

  it('says in red a session that read then dropped, not « not linked yet » (27/11/2026)', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        reveal: {
          connected: false,
          lastReadAt: '2026-10-19T11:00:00Z',
          late: false,
          outage: null,
          conversations: 0,
        },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.title).toBe(
        'Agent : Copilote. La lecture de Reveal est coupée : l’IA ne lit plus les fans. Voir le Dashboard.',
      );
    });
    expect(pill.textContent).toBe('Reveal coupé');
    expect(pill.dataset['tone']).toBe('bad');
    expect(pill.dataset['reveal']).toBe('cut');
    expect(pill.querySelector('.nv-rail__beat')).toBeNull();
    // The phone's bar has no pill: a red dot on the Dashboard's tab says it there.
    expect(screen.getByRole('img', { name: 'Lecture de Reveal coupée' })).not.toBeNull();
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
    localStorage.setItem('impera.followed-creator', CREATOR.id);
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

  it('speaks of the creator a sheet of Créatrices shows, and opens her Dashboard (recette 05/11, PRO-28)', async () => {
    const ana = { id: '0192f3a0-0000-7000-8000-0000000000c2', displayName: 'Ana', timezone: 'Europe/Paris' };
    localStorage.setItem('impera.followed-creator', CREATOR.id);
    try {
      serveDashboard(
        (url) => live(url.searchParams.get('creatorId') === ana.id ? 'stop' : 'copilot'),
        [ana, CREATOR],
      );
      const pill = await renderPill(`/creatrices?creatrice=${ana.id}`);
      await waitFor(() => {
        expect(pill.textContent).toContain('Arrêt');
      });
      expect(pill.getAttribute('href')).toBe(`/?creatrice=${ana.id}`);
    } finally {
      localStorage.clear();
    }
  });

  it('cuts a long name inside the pill, the title keeping it whole (recette 05/11, PRO-12)', async () => {
    serveDashboard(live('copilot'));
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.querySelector('.nv-rail__agent-label')?.textContent).toBe('Copilote');
    });
  });

  it('names no creator when the account follows only one', async () => {
    serveDashboard(live('copilot'));
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Copilote');
    });
  });

  it('says in amber a Reveal read late when the session holds (recette 28/10, G8; 27/11/2026)', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        reveal: {
          connected: true,
          lastReadAt: '2026-10-19T11:00:00Z',
          late: true,
          outage: null,
          conversations: 12,
        },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.title).toBe('Agent : Copilote. Reveal est lu avec du retard. Voir le Dashboard.');
    });
    expect(pill.textContent).toBe('Reveal en retard');
    expect(pill.dataset['tone']).toBe('warn');
    expect(pill.dataset['reveal']).toBeUndefined();
  });

  it('says a read cut by Reveal itself in red, the session still held (27/11/2026)', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'copilot',
        reveal: {
          connected: true,
          lastReadAt: '2026-10-19T11:50:00Z',
          late: false,
          outage: { reason: 'format_changed', since: '2026-10-19T11:52:00Z' },
          conversations: 12,
        },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.textContent).toBe('Reveal coupé');
    });
    expect(pill.dataset['tone']).toBe('bad');
  });

  it('beats its dot once at each read of Reveal, never in a loop (27/11/2026)', async () => {
    serveDashboard(live('copilot'));
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.querySelector('.nv-rail__beat')).not.toBeNull();
    });
    expect(pill.querySelector('.nv-dot--live')).toBeNull();
    expect(screen.queryByRole('img', { name: 'Lecture de Reveal coupée' })).toBeNull();
  });

  it('says nothing of Reveal while the agent is stopped', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        mode: 'stop',
        reveal: {
          connected: true,
          lastReadAt: '2026-10-19T11:50:00Z',
          late: false,
          outage: { reason: 'unreachable', since: '2026-10-19T11:52:00Z' },
          conversations: 12,
        },
      }),
    });
    const pill = await renderPill();
    await waitFor(() => {
      expect(pill.dataset['tone']).not.toBe('bad');
    });
    expect(pill.textContent).not.toContain('Reveal');
    expect(screen.queryByRole('img', { name: 'Lecture de Reveal coupée' })).toBeNull();
  });
});
