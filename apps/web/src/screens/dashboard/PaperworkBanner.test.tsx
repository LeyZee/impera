// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PaperworkBanner } from './PaperworkBanner';

import { documentOf } from '@/test/contractors';
import { invoiceOf, LOU, OCT1, OCT2, THEO } from '@/test/pay';

const reads: string[] = [];

function serve(answers: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const key = `${url.pathname}${url.search}`;
      reads.push(key);
      const body = answers[key];
      return Promise.resolve(
        body === undefined
          ? new Response('null', { status: 404 })
          : new Response(JSON.stringify(body), { status: 200 }),
      );
    }),
  );
}

function renderBanner(enabled: boolean): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <div>
        <p>Dashboard</p>
        <PaperworkBanner enabled={enabled} />
      </div>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  reads.length = 0;
  vi.unstubAllGlobals();
});

describe('the owner’s invoices’ card on the Dashboard (EQ-06 lot 8d)', () => {
  it('says the late invoice in red, the contest, the documents to check, each leading where it is settled', async () => {
    serve({
      '/v1/payroll/invoices?due=soon%2Coverdue': {
        today: '2026-11-05',
        documents: [invoiceOf(1, THEO, OCT1, { due: 'overdue' }), invoiceOf(2, LOU, OCT2, { due: 'soon' })],
      },
      '/v1/payroll/invoices?acceptance=contested': {
        today: '2026-11-05',
        documents: [
          invoiceOf(3, LOU, OCT2, {
            acceptance: {
              state: 'contested',
              deadline: '2026-11-09T22:59:00.000Z',
              reason: 'Il manque un rapport.',
            },
          }),
        ],
      },
      '/v1/payroll/contractors/documents?review=pending': {
        documents: [{ ...documentOf(5, { review: null, remindFrom: null }), displayName: 'Théo' }],
        more: false,
      },
    });
    renderBanner(true);
    const card = (await screen.findByText('Factures et pièces')).closest('aside');
    if (card === null) throw new Error('No card');
    const late = await within(card).findByText('1 facture en retard : l’échéance est passée sans règlement.');
    expect(late.closest('li')?.getAttribute('data-tone')).toBe('danger');
    expect(within(card).getByText('1 facture arrive à échéance dans les sept jours.')).toBeTruthy();
    expect(within(card).getByText('1 contestation à trancher.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Théo' }).getAttribute('href')).toBe(
      `/equipe/membres/${THEO.id}/dossier`,
    );
    expect(within(card).getByRole('link', { name: 'Voir les factures' }).getAttribute('href')).toBe(
      '/paie/factures',
    );
  });

  it('says nothing while nothing waits, and asks nothing for anyone but the owner', async () => {
    serve({
      '/v1/payroll/invoices?due=soon%2Coverdue': { today: '2026-11-05', documents: [] },
      '/v1/payroll/invoices?acceptance=contested': { today: '2026-11-05', documents: [] },
      '/v1/payroll/contractors/documents?review=pending': { documents: [], more: false },
    });
    renderBanner(true);
    await screen.findByText('Dashboard');
    await vi.waitFor(() => {
      expect(reads).toHaveLength(3);
    });
    expect(screen.queryByText('Factures et pièces')).toBeNull();
    cleanup();
    reads.length = 0;
    renderBanner(false);
    await screen.findByText('Dashboard');
    expect(reads).toEqual([]);
  });
});
