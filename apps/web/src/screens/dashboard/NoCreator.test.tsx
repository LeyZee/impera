// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';
import { apiDashboard, serveDashboard } from '@/test/fakes';

const base = {
  id: 'u1',
  email: 'membre@recette.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  preferences: { sounds: true },
};
const owner: Me = { ...base, role: 'owner', team: null, teamScope: 'owner' };
const manager: Me = {
  ...base,
  role: 'operator',
  team: { role: 'manager', status: 'active' },
  teamScope: 'agency',
};
const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  // No creator in the agency yet: nothing waits, no stop holds her messages.
  serveDashboard(
    (url) =>
      url.pathname === '/v1/dashboard/todos'
        ? { status: 200, body: { items: [], creators: [] } }
        : url.pathname === '/v1/conversations/stop'
          ? { status: 200, body: { stopped: false } }
          : { status: 200, body: apiDashboard() },
    [],
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The app as it opens for `user` on `path`: the real router, its rail and the props it gives each screen. */
function renderApp(user: Me, path: string): void {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/**
 * Before any creator exists (DASH-13): only the owner adds one (Créatrices), so only he is asked to; a manager or an
 * operator reads that none is entrusted to him yet, with no button that leads to a screen where he can add nothing.
 */
describe('the Dashboard and Suivi before any creator, as each role opens them', () => {
  it('asks the owner for his first creator, on the Dashboard and in Suivi', async () => {
    renderApp(owner, '/');
    expect(await screen.findByText(/première créatrice/u)).toBeDefined();
    expect(screen.getByRole('link', { name: 'Aller à Créatrices' }).getAttribute('href')).toBe('/creatrices');
    cleanup();
    renderApp(owner, '/suivi');
    expect(await screen.findByText('Aucune créatrice pour l’instant')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Aller à Créatrices' })).toBeDefined();
  });

  it('never asks a manager nor an operator to add one: none is entrusted to him yet', async () => {
    for (const user of [manager, operator]) {
      renderApp(user, '/');
      expect(await screen.findByText(/ne t’est confiée/u), user.team?.role ?? user.role).toBeDefined();
      expect(
        screen.getByText('C’est le propriétaire de l’agence qui te les confie. Elles apparaîtront ici.'),
      ).toBeDefined();
      expect(screen.queryByText(/première créatrice/u)).toBeNull();
      expect(screen.queryByRole('link', { name: 'Aller à Créatrices' })).toBeNull();
      cleanup();
      renderApp(user, '/suivi');
      expect(await screen.findByText('Rien pour toi pour l’instant')).toBeDefined();
      expect(screen.queryByText(/première créatrice/u)).toBeNull();
      expect(screen.queryByRole('link', { name: 'Aller à Créatrices' })).toBeNull();
      cleanup();
    }
  });
});
