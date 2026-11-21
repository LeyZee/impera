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
  preferences: { sounds: true },
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
  // A computer's width: the list stands beside the section open.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
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

async function settingsTabs(user: Me, at = '/reglages/modeles-ia'): Promise<string[]> {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: [at] }),
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

describe('Réglages’ list', () => {
  it('gives Bots Telegram to the owner, whom the server serves it to', async () => {
    expect(await settingsTabs(owner)).toContain('Bots Telegram');
  });

  it('opens the list on the platforms (the sales feeds, CRM-01), then the Telegram bots', async () => {
    const tabs = await settingsTabs(owner);
    expect(tabs.slice(0, 2)).toEqual(['Plateformes', 'Bots Telegram']);
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

describe('Réglages as a list (recette visuelle 16/11, GES-04)', () => {
  it('groups its sections in four titled groups: Connexions, IA, Argent, Protection (ADR 0134 § 6, renamed 21/11)', async () => {
    const lines = await settingsTabs(owner);
    expect(lines).toEqual([
      'Plateformes',
      'Bots Telegram',
      'Modèles IA',
      'Consommation IA',
      'Règles de paie',
      'Facturation',
      'Alertes',
      'Sauvegardes',
      'Sécurité',
    ]);
    const nav = screen.getByRole('navigation', { name: 'Réglages' });
    expect([...nav.querySelectorAll('.rgl-list__group')].map((title) => title.textContent)).toEqual([
      'Connexions',
      'IA',
      'Argent',
      'Protection',
    ]);
  });

  it('names the section open as the title, « Réglages » above it, and lights its line', async () => {
    await settingsTabs(owner, '/reglages/regles-de-paie');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Règles de paie');
    const header = document.querySelector<HTMLElement>('.nv-page__head');
    if (header === null) throw new Error('no header');
    expect(within(header).getByText('Réglages').className).toBe('rgl-eyebrow');
    expect(within(header).getByRole('link', { name: '← Réglages' }).getAttribute('href')).toBe('/reglages');
    const nav = screen.getByRole('navigation', { name: 'Réglages' });
    expect(within(nav).getByRole('link', { name: 'Règles de paie' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('is the screen of Réglages on a phone: the list alone, with no section open', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    const lines = await settingsTabs(owner, '/reglages');
    expect(lines).toHaveLength(9);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Réglages');
    expect(screen.queryByRole('link', { name: '← Réglages' })).toBeNull();
    expect(document.querySelector('.rgl-body')?.hasAttribute('data-open')).toBe(false);
  });

  it('opens on its first section on a computer', async () => {
    const router = createAppRouter(
      { user: owner, onSignOut: () => undefined },
      createMemoryHistory({ initialEntries: ['/reglages'] }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/reglages/ventes');
    });
  });
});

describe('Pages without a screen (recette 05/11, PRO-25)', () => {
  it.each([
    ['/entrainer/corrections', '/entrainer/playground'],
    ['/entrainer/tests', '/entrainer/playground'],
    ['/reglages/appareils', '/reglages/ventes'],
    ['/reglages/mode', '/reglages/ventes'],
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

describe('Réglages › Plateformes, the creators found and not imported yet (CRM-07 b2, ADR 0069 § 5)', () => {
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
    const tab = await within(nav).findByRole('link', {
      name: 'Plateformes, 3 nouvelles créatrices sur Reveal',
    });
    expect(within(tab).getByText('3').getAttribute('title')).toBe('3 nouvelles créatrices sur Reveal');
  });

  it('shows the tab bare when none waits or the count cannot be read', async () => {
    serveNewModels(() => answer({ total: 0, byPlatform: [] }));
    expect(await settingsTabs(owner)).toContain('Plateformes');
    cleanup();
    serveNewModels(() => answer({ error: { code: 'internal', message: 'Erreur' } }, 500));
    const tabs = await settingsTabs(owner);
    expect(tabs).toContain('Plateformes');
    expect(tabs.some((tab) => tab.includes('nouvelle'))).toBe(false);
  });
});
