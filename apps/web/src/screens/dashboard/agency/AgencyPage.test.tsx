// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '../DashboardPage';

import { AgencyPage } from './AgencyPage';
import { AGENCY_WEEK } from './fixture';

import { apiDashboard, CREATOR, serveDashboard } from '@/test/fakes';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** The agency's figures on their route, the agent's Dashboard on its own. */
function serve(creators: readonly (typeof CREATOR)[] = [CREATOR]): void {
  serveDashboard(
    (url) =>
      url.pathname === '/v1/dashboard/agency'
        ? { status: 200, body: AGENCY_WEEK }
        : { status: 200, body: apiDashboard() },
    creators,
  );
}

function show(page: () => ReactNode): void {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: page }),
      ...[
        '/creatrices',
        '/reglages/ventes',
        '/reglages/telegram',
        '/reglages/sauvegardes',
        '/reglages/modeles-ia',
        '/suivi',
      ].map((path) => createRoute({ getParentRoute: () => root, path })),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('the agency’s Dashboard (ADR 0078)', () => {
  it('opens on the agency’s figures, the choice of a creator left to the menu’s selector (ADR 0134 § 3)', async () => {
    serve();
    show(() => (
      <AgencyPage
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    expect(await screen.findByRole('heading', { name: /L’agence en chiffres/u })).toBeTruthy();
    // A title, as on every screen (recette visuelle 16/11, PIL-04).
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    // No chips of its own any more: one selector, in the menu.
    expect(screen.queryByRole('radio', { name: /Toute l’agence/u })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Ce que montre le Dashboard' })).toBeNull();
  });

  it('says the AI budget in the banners’ face, without « Pour toute l’agence » on the agency’s view (ADM-26)', async () => {
    serve();
    show(() => (
      <AgencyPage
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    const budget = await screen.findByRole('complementary', { name: 'Budget IA du jour, toutes créatrices' });
    expect(budget.textContent).not.toContain('Pour toute l’agence');
    expect(budget.querySelector('.db-orb')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Voir les modèles IA' }).getAttribute('href')).toBe(
      '/reglages/modeles-ia',
    );
  });

  it('asks for a first creator before any, never empty charts (DASH-13)', async () => {
    serve([]);
    show(() => (
      <AgencyPage
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    expect(await screen.findByRole('link', { name: 'Aller à Créatrices' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /L’agence en chiffres/u })).toBeNull();
  });

  it('puts the figures before what the agency runs, the AI budget last (PIL-04)', async () => {
    serve();
    show(() => (
      <AgencyPage
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    const budget = await screen.findByRole('complementary', { name: 'Budget IA du jour, toutes créatrices' });
    const figures = await screen.findByRole('heading', { name: /L’agence en chiffres/u });
    expect(figures.compareDocumentPosition(budget) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts her agent first on a creator’s Dashboard, her figures under it, nothing of the agency’s (PIL-01, PIL-04)', async () => {
    serve();
    show(() => (
      <DashboardPage
        period="week"
        onPeriod={() => undefined}
        forOwner
        agency={{
          selection: { unit: 'week' },
          onSelection: () => undefined,
          onAgency: () => undefined,
          canOpenSettings: true,
        }}
      />
    ));
    const figures = await screen.findByRole('heading', { name: /Les chiffres de/u });
    const hero = document.querySelector('.db-hero');
    if (hero === null) throw new Error('hero');
    expect(hero.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Budget IA du jour/u)).toBeNull();
  });

  it('puts her figures first on a creator’s Dashboard, one period control, no second sales panel', async () => {
    serve();
    show(() => (
      <DashboardPage
        period="week"
        onPeriod={() => undefined}
        forOwner
        agency={{
          selection: { unit: 'week' },
          onSelection: () => undefined,
          onAgency: () => undefined,
          canOpenSettings: true,
        }}
      />
    ));
    expect(await screen.findByRole('heading', { name: /Les chiffres de/u })).toBeTruthy();
    // Whose it is reads in the header: the chips are gone, the menu's selector chooses (ADR 0134 § 3).
    expect(screen.queryByRole('radio', { name: /Toute l’agence/u })).toBeNull();
    expect(screen.getAllByRole('radiogroup', { name: 'Période' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /Ventes lues chez/u })).toBeNull();
  });
});
