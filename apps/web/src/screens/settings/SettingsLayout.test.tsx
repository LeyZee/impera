// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';

/* Invented members: no real person. */
const base = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
};
const owner: Me = { ...base, role: 'owner', team: null, teamScope: 'owner' };

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  // The pages stay on their loading state: only the tabs are under test.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settingsTabs(user: Me): Promise<string[]> {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: ['/reglages/modeles-ia'] }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const nav = await screen.findByRole('navigation', { name: 'Réglages' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

describe('Réglages tabs', () => {
  it('gives Telegram to the owner, whom the server serves it to', async () => {
    expect(await settingsTabs(owner)).toContain('Telegram');
  });

  it('gives the sales feeds (CRM-01) a tab right after the AI keys', async () => {
    const tabs = await settingsTabs(owner);
    expect(tabs.slice(0, 2)).toEqual(['Modèles IA', 'Ventes']);
  });

  it('keeps Apparence and « Se déconnecter » out of the tabs: both live in the account menu (NAV-03)', async () => {
    const tabs = await settingsTabs(owner);
    expect(tabs).not.toContain('Apparence');
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });

  it('gives no tab to Appareils nor Mode de l’agent while their screens only say « à venir »', async () => {
    const tabs = await settingsTabs(owner);
    expect(tabs).not.toContain('Appareils');
    expect(tabs).not.toContain('Mode de l’agent');
  });
});

describe('Pages without a screen (recette 05/11, PRO-25)', () => {
  it.each([
    ['/entrainer/corrections', '/entrainer/playground'],
    ['/entrainer/tests', '/entrainer/playground'],
    ['/reglages/appareils', '/reglages/modeles-ia'],
    ['/reglages/mode', '/reglages/modeles-ia'],
  ])('sends %s to %s instead of an « à venir » page', async (address, home) => {
    const router = createAppRouter(
      { user: owner, onSignOut: () => undefined },
      createMemoryHistory({ initialEntries: [address] }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe(home);
    });
  });
});

describe('Réglages › Ventes, the creators found and not imported yet (CRM-07 b2, ADR 0069 § 5)', () => {
  const answer = (body: unknown, status = 200): Promise<Response> =>
    Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    );
  const serveNewModels = (reply: () => Promise<Response>): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        input.endsWith('/v1/settings/sales-feeds/new-models')
          ? reply()
          : new Promise<Response>(() => undefined),
      ),
    );
  };

  it('counts them on the tab, said in words to a screen reader', async () => {
    serveNewModels(() => answer({ total: 3, byPlatform: [{ platform: 'reveal', count: 3 }] }));
    await settingsTabs(owner);
    const nav = screen.getByRole('navigation', { name: 'Réglages' });
    const tab = await within(nav).findByRole('link', { name: 'Ventes, 3 nouvelles créatrices sur Reveal' });
    expect(within(tab).getByText('3').getAttribute('title')).toBe('3 nouvelles créatrices sur Reveal');
  });

  it('shows the tab bare when none waits or the count cannot be read', async () => {
    serveNewModels(() => answer({ total: 0, byPlatform: [] }));
    expect(await settingsTabs(owner)).toContain('Ventes');
    cleanup();
    serveNewModels(() => answer({ error: { code: 'internal', message: 'Erreur' } }, 500));
    const tabs = await settingsTabs(owner);
    expect(tabs).toContain('Ventes');
    expect(tabs.some((tab) => tab.includes('nouvelle'))).toBe(false);
  });
});
