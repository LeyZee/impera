// @vitest-environment jsdom
import type { TeamMember } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyOwnInvoicesPage } from './MyOwnInvoicesPage';

import { invoiceOf, IRIS, IRIS_ME, MEMBERS, OCT2, SCHEDULING_SETTINGS } from '@/test/pay';

let members: TeamMember[];
const reads: string[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      switch (url.pathname) {
        case '/v1/payroll/invoices':
          reads.push(url.search);
          return json({
            today: '2026-11-05',
            documents: url.searchParams.get('memberId') === IRIS.id ? [invoiceOf(7, IRIS, OCT2)] : [],
          });
        case '/v1/team/members':
          return json({ members });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        default:
          return json({ items: [], nextCursor: null });
      }
    }),
  );
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/factures',
    component: () => <MyOwnInvoicesPage user={IRIS_ME} />,
  });
  const file = createRoute({ getParentRoute: () => root, path: '/moi/dossier', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, file]),
    history: createMemoryHistory({ initialEntries: ['/moi/factures'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  members = MEMBERS;
  reads.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Moi › Factures', () => {
  it('reads the manager’s own documents alone, never the agency’s he reads in Paie', async () => {
    renderPage();
    await screen.findByText(invoiceOf(7, IRIS, OCT2).number);
    expect(reads).toEqual([`?memberId=${IRIS.id}&from=2025-11-05&to=2026-11-05`]);
    expect(screen.getByRole('link', { name: 'Dossier' }).getAttribute('href')).toBe('/moi/dossier');
  });

  it('reads nothing while his team record cannot be found', async () => {
    members = [];
    renderPage();
    await screen.findByText('Ta fiche d’équipe est introuvable : le propriétaire peut la vérifier.');
    await waitFor(() => {
      expect(reads).toEqual([]);
    });
  });
});
