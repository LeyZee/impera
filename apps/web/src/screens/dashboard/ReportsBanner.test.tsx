// @vitest-environment jsdom
import { ShiftReportSchema, type ShiftReport, type ShiftReportCheck } from '@impera/contracts';
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

import { ReportsBanner } from './ReportsBanner';

const reads: string[] = [];

function serve(reports: readonly ShiftReport[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      reads.push(url.pathname);
      return Promise.resolve(
        url.pathname === '/v1/scheduling/shift-reports'
          ? new Response(JSON.stringify({ reports, shifts: [], accounts: [], members: [] }), { status: 200 })
          : new Response('null', { status: 404 }),
      );
    }),
  );
}

let next = 0;
/** A sent report the reader may review, with what its platform read (invented amounts, ADR 0010). */
function sent(check: ShiftReportCheck | null, explanation: string | null = null): ShiftReport {
  next += 1;
  const tail = String(next).padStart(3, '0');
  return ShiftReportSchema.parse({
    id: `01a17ff2-0000-7000-8000-000000000${tail}`,
    shiftId: `01a17ff2-0000-7000-8000-000000001${tail}`,
    creatorId: '01a17ff2-0000-7000-8000-000000000a01',
    platformAccountId: '01a17ff2-0000-7000-8000-000000000a02',
    memberId: '01a17ff2-0000-7000-8000-000000000a03',
    period: '2026-10-16',
    correctsId: null,
    amount: { amountMinor: 18_400, currency: 'EUR' },
    comment: null,
    incident: null,
    status: 'submitted',
    version: 1,
    byAgency: false,
    reviewKind: null,
    explanation,
    check,
    canReview: true,
    submittedAt: '2026-10-26T22:05:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-10-26T22:05:00.000Z',
  });
}

const gap = (explainBy: string): ShiftReportCheck => ({
  state: 'complete',
  readMinor: 17_200,
  gapMinor: 1_200,
  verdict: 'gap',
  explainBy,
});
const WAITING = gap('2099-01-01T00:00:00.000Z');
const PAST = gap('2020-01-01T00:00:00.000Z');
const WITHIN: ShiftReportCheck = {
  state: 'complete',
  readMinor: 18_400,
  gapMinor: 0,
  verdict: 'within',
  explainBy: null,
};

function renderBanner(enabled: boolean): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <div>
        <p>Dashboard</p>
        <ReportsBanner enabled={enabled} />
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

describe('the reports that wait on the agency, on the Dashboard (ADR 0073)', () => {
  it('says the gaps to decide in amber, the reports to validate, the gaps still waiting for their member', async () => {
    serve([
      sent(PAST),
      sent(WAITING, 'Un pack payé juste après la fin du shift.'),
      sent(null),
      sent({ state: 'provisional', readMinor: 5_900 }),
      sent(WAITING),
      sent(WITHIN),
    ]);
    renderBanner(true);
    const card = (await screen.findByText('Rapports de fin de shift')).closest('aside');
    if (card === null) throw new Error('no card');
    const lines = within(card).getAllByRole('listitem');
    expect(lines.map((line) => [line.textContent, line.dataset['tone']])).toEqual([
      ['2 écarts à trancher', 'warn'],
      ['2 rapports à valider', 'quiet'],
      ['1 écart attend l’explication de son membre', 'quiet'],
    ]);
    expect(within(card).getByRole('link', { name: 'Voir les rapports' }).getAttribute('href')).toBe(
      '/equipe/rapports',
    );
  });

  it('says nothing when nothing waits on the agency: a report the automatic check validates is no one’s', async () => {
    serve([sent(WITHIN)]);
    renderBanner(true);
    await screen.findByText('Dashboard');
    await vi.waitFor(() => {
      expect(reads).toContain('/v1/scheduling/shift-reports');
    });
    expect(screen.queryByText('Rapports de fin de shift')).toBeNull();
  });

  it('reads nothing for an account that reviews no report', async () => {
    serve([sent(null)]);
    renderBanner(false);
    await screen.findByText('Dashboard');
    expect(reads).toEqual([]);
    expect(screen.queryByText('Rapports de fin de shift')).toBeNull();
  });
});
