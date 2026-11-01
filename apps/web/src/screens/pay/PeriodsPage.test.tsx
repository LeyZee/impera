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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeriodsPage } from './PeriodsPage';

import {
  BASILE,
  LOU,
  MEMBERS,
  NOV1,
  OCT2,
  OWNER,
  OWNER_USER,
  periodOf,
  SCHEDULING_SETTINGS,
  statementOf,
  summaryFor,
  THEO,
} from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;

let index: { status: number; body: unknown };

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      switch (url.pathname) {
        case '/v1/payroll/periods':
          return json(index.body, index.status);
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        case '/v1/team/members':
          return json({ members: MEMBERS });
        default:
          return json({ items: [], nextCursor: null });
      }
    }),
  );
}

function renderPage(): { opened: () => string } {
  const root = createRootRoute();
  let opened = '';
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/releves',
    component: () => (
      <PeriodsPage
        user={OWNER}
        onOpen={(period) => {
          opened = period;
        }}
      />
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/paie/releves'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { opened: () => opened };
}

const rowText = (name: string): string =>
  (screen.getByText(name).closest('button')?.textContent ?? '').replace(NBSP, ' ');

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
  const paidOctober = periodOf(
    OCT2,
    [
      statementOf(THEO, OCT2, {
        status: 'paid',
        canValidate: false,
        paidAt: '2026-11-02T10:00:00.000Z',
        paidBy: OWNER_USER,
        payment: { paidOn: '2026-11-02', method: 'worldremit', reference: null, sentMinor: 2_125 },
      }),
      statementOf(LOU, OCT2, {
        status: 'validated',
        canValidate: false,
        totalMinor: 1_200,
        carryOverOutMinor: 1_200,
        payableMinor: 0,
      }),
    ],
    {
      closing: {
        period: OCT2,
        exchangeRates: [],
        closedBy: OWNER_USER,
        closedAt: '2026-11-02T08:41:00.000Z',
      },
    },
  );
  const november = periodOf(NOV1, [statementOf(THEO, NOV1), statementOf(BASILE, NOV1)]);
  index = { status: 200, body: { items: [summaryFor(november), summaryFor(paidOctober)], nextCursor: null } };
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Paie › Historique', () => {
  it('lists the periods, the most recent first, each with one amount and its net, closing and statements beneath', async () => {
    const page = renderPage();
    await screen.findByText('1er – 15 novembre 2026');
    // A list of periods, not of statements (a statement is one member's computation).
    expect(screen.getByRole('heading', { level: 1, name: 'Historique' })).toBeTruthy();
    expect(rowText('1er – 15 novembre 2026')).toBe(
      '1er – 15 novembre 2026En cours · 170,00 € de net à ce jour · se valide à partir du lun. 16 nov.En cours42,50 €à verser à ce jour',
    );
    expect(rowText('16 – 31 octobre 2026')).toBe(
      '16 – 31 octobre 2026Close le lun. 2 nov. par Charles · 170,00 € de net · 1 payé, 1 validé · 1 reportéPayée21,25 €versé',
    );
    fireEvent.click(screen.getByText('16 – 31 octobre 2026'));
    expect(page.opened()).toBe(OCT2);
  });

  it('says there is no period yet, and a server that does not answer, never one for the other', async () => {
    index = { status: 200, body: { items: [], nextCursor: null } };
    renderPage();
    expect(await screen.findByText('Aucune quinzaine pour l’instant.')).toBeTruthy();
    cleanup();

    index = {
      status: 500,
      body: { error: { code: 'internal_error', message: 'x', details: {}, requestId: 'r' } },
    };
    renderPage();
    // The list tries twice more before it says so.
    await waitFor(
      () => {
        expect(
          screen.getByText('Le serveur ne répond pas : les quinzaines n’ont pas pu être lues.'),
        ).toBeTruthy();
      },
      { timeout: 5_000 },
    );
    expect(screen.queryByText('Aucune quinzaine pour l’instant.')).toBeNull();
  });
});
