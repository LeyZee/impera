// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  it('opens on « Toute l’agence », and the arrows lead to a creator', async () => {
    serve();
    const chosen: string[] = [];
    show(() => (
      <AgencyPage
        period="week"
        onPeriod={() => undefined}
        onCreator={(id) => chosen.push(id)}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    const agency = await screen.findByRole('radio', { name: /Toute l’agence/u });
    expect(agency.getAttribute('aria-checked')).toBe('true');
    expect(agency.tabIndex).toBe(0);
    expect(await screen.findByRole('heading', { name: /L’agence en chiffres/u })).toBeTruthy();
    fireEvent.keyDown(agency, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(chosen).toEqual([CREATOR.id]);
    });
  });

  it('says the AI budget in the banners’ face, without « Pour toute l’agence » on the agency’s view (ADM-26)', async () => {
    serve();
    show(() => (
      <AgencyPage
        period="week"
        onPeriod={() => undefined}
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
        period="week"
        onPeriod={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    expect(await screen.findByRole('link', { name: 'Aller à Créatrices' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /L’agence en chiffres/u })).toBeNull();
  });

  it('puts her figures first on a creator’s Dashboard, one period control, no second sales panel', async () => {
    serve();
    show(() => (
      <DashboardPage
        period="week"
        onPeriod={() => undefined}
        forOwner
        agency={{
          period: 'week',
          onPeriod: () => undefined,
          onAgency: () => undefined,
          canOpenSettings: true,
        }}
      />
    ));
    expect(await screen.findByRole('heading', { name: /Les chiffres de/u })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Toute l’agence/u }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByRole('radiogroup', { name: 'Période' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /Ventes lues chez/u })).toBeNull();
  });
});
