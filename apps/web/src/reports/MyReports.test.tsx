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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyReportsCard, useMyReports } from './MyReports';

import { settingsOf } from '@/test/settings';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* An invented creator and member (ADR 0010): one shift of hers validated, one ended without its report. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NORA = id(1);
const NORA_REVEAL = id(11);
const THEO = id(21);

const shift = (n: number, startsAt: string, endsAt: string): Record<string, unknown> => ({
  id: id(n),
  creatorId: NORA,
  platformAccountId: NORA_REVEAL,
  memberId: THEO,
  startsAt,
  endsAt,
  templateId: null,
  stoppedAt: null,
});

const DONE = shift(101, '2026-11-02T08:00:00Z', '2026-11-02T14:00:00Z');
const LEFT = shift(102, '2026-11-04T08:00:00Z', '2026-11-04T14:00:00Z');
const VALIDATED = {
  id: id(601),
  shiftId: id(101),
  creatorId: NORA,
  platformAccountId: NORA_REVEAL,
  memberId: THEO,
  period: '2026-11-01',
  correctsId: null,
  amount: { amountMinor: 123_456, currency: 'EUR' },
  comment: null,
  incident: null,
  status: 'validated',
  version: 1,
  byAgency: false,
  reviewKind: null,
  explanation: null,
  check: null,
  canReview: false,
  submittedAt: '2026-11-02T14:10:00Z',
  reviewedAt: '2026-11-02T16:00:00Z',
  reviewNote: null,
  createdAt: '2026-11-02T14:10:00Z',
};

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const body =
        url.pathname === '/v1/scheduling/settings'
          ? settingsOf()
          : url.pathname === '/v1/scheduling/shift-reports'
            ? url.searchParams.get('period') === '2026-11-01'
              ? {
                  reports: [VALIDATED],
                  shifts: [DONE, LEFT],
                  accounts: [
                    {
                      id: NORA_REVEAL,
                      creatorId: NORA,
                      creatorName: 'Nora Vidal',
                      platform: 'reveal',
                      handle: 'nora',
                      archived: false,
                    },
                  ],
                  members: [{ id: THEO, displayName: 'Théo', color: null }],
                }
              : { reports: [], shifts: [], accounts: [], members: [] }
            : null;
      return Promise.resolve(new Response(JSON.stringify(body), { status: body === null ? 404 : 200 }));
    }),
  );
}

function Card(): React.JSX.Element | null {
  const reports = useMyReports(new Date('2026-11-05T12:00:00Z'));
  return <MyReportsCard reports={reports} heroShiftId={null} onOpen={() => undefined} />;
}

function renderCard(): void {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/aujourdhui', component: Card });
  const pay = createRoute({ getParentRoute: () => root, path: '/commissions', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, pay]),
    history: createMemoryHistory({ initialEntries: ['/aujourdhui'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(serve);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Aujourd’hui › Mes rapports (recette 05/11)', () => {
  it('names the figure for what it is, the gross of his sales, and sends to Commissions for his due (CHAT-20)', async () => {
    renderCard();
    const label = await screen.findByText('Ventes validées');
    expect(label.nextElementSibling?.textContent.replace(/[\u00a0\u202f]/gu, ' ')).toBe('1 234,56 €');
    expect([...document.querySelectorAll('.rp-figures__label')].map((one) => one.textContent)).toEqual([
      'Ventes validées',
    ]);
    expect(
      screen.getByRole('link', { name: 'Ta commission est dans Commissions' }).getAttribute('href'),
    ).toBe('/commissions');
  });
});
