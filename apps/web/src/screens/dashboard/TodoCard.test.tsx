// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TodoCard } from './TodoCard';

import { documentOf } from '@/test/contractors';
import { invoiceOf, LOU, MEMBERS, OCT1, OCT2, THEO } from '@/test/pay';
import { PAST, sent, WITHIN } from '@/test/reports';

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

function renderCard(forOwner: boolean, reviewsReports = false): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <div>
        <p>Dashboard</p>
        <TodoCard forOwner={forOwner} reviewsReports={reviewsReports} />
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

const BACKUP_LATE = {
  state: 'overdue',
  lastSucceededAt: '2026-10-26T02:12:00.000Z',
  overdueAfterHours: 26,
  lastRun: null,
  lastRestoreTest: null,
  restoreTestFresh: true,
};
const BACKUP_OK = { ...BACKUP_LATE, state: 'ok' };
const NOTHING = {
  '/v1/payroll/invoices?due=soon%2Coverdue': { today: '2026-11-05', documents: [] },
  '/v1/payroll/invoices?acceptance=contested': { today: '2026-11-05', documents: [] },
  '/v1/payroll/contractors/documents?review=pending': { documents: [], more: false },
  '/v1/backups/status': BACKUP_OK,
  '/v1/creator-messages/waiting': { messages: [] },
  '/v1/dashboard/setup/members': { members: [] },
  '/v1/payroll/payout-destinations': { destinations: [] },
  '/v1/team/members': { members: MEMBERS },
};

describe('« À faire » on the Dashboard (pilotage 12/11, W3)', () => {
  it('gathers what waits in one card, the red first, each line leading where it is settled', async () => {
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
      '/v1/backups/status': BACKUP_LATE,
    });
    renderCard(true);
    const card = (await screen.findByRole('heading', { name: 'À faire' })).closest('section');
    if (card === null) throw new Error('No card');
    await within(card).findByText('1 facture en retard');
    await within(card).findByText(/^Aucune sauvegarde réussie depuis le 26 octobre/u);
    // The four most pressing first; the rest opens in place.
    expect(within(card).getAllByRole('listitem')).toHaveLength(4);
    fireEvent.click(await within(card).findByRole('button', { name: 'Et 1 autre' }));
    await within(card).findByText('1 pièce à examiner');
    await within(card).findByText(/^Aucune sauvegarde réussie depuis le 26 octobre/u);
    const lines = within(card).getAllByRole('listitem');
    expect(lines.map((line) => line.dataset['tone'])).toEqual(['danger', 'warn', 'warn', 'warn', 'neutral']);
    expect(lines[0]?.textContent).toContain('L’échéance est passée sans règlement.');
    expect(within(card).getByLabelText('5 à traiter').textContent).toBe('5');
    // The whole line is the link: no banner, no button of its own.
    expect(
      within(card)
        .getByRole('link', { name: /^1 facture en retard/u })
        .getAttribute('href'),
    ).toBe('/paie/factures');
    expect(
      within(card)
        .getByRole('link', { name: /^1 contestation à trancher/u })
        .getAttribute('href'),
    ).toBe('/paie/factures');
    expect(
      within(card)
        .getByRole('link', { name: /^Aucune sauvegarde réussie/u })
        .getAttribute('href'),
    ).toBe('/reglages/sauvegardes');
    expect(within(card).getByRole('link', { name: 'Théo' }).getAttribute('href')).toBe(
      `/equipe/membres/${THEO.id}/dossier`,
    );
  });

  it('shows no card while nothing waits, and asks nothing for an account that settles none of it', async () => {
    serve(NOTHING);
    renderCard(true);
    await screen.findByText('Dashboard');
    await vi.waitFor(() => {
      expect(reads).toHaveLength(8);
    });
    expect(screen.queryByRole('heading', { name: 'À faire' })).toBeNull();
    cleanup();
    reads.length = 0;
    renderCard(false);
    await screen.findByText('Dashboard');
    expect(reads).toEqual([]);
  });

  it('says what would hold the first transfer back in one amber line, then who else has some (recette PARC-01)', async () => {
    serve({
      ...NOTHING,
      '/v1/dashboard/setup/members': {
        members: [
          {
            memberId: THEO.id,
            teamRole: 'chatter',
            steps: [
              {
                key: 'billing',
                state: 'todo',
                note: {
                  kind: 'billing',
                  reason: 'mandate_unpublished',
                  reasons: ['mandate_unpublished', 'prefix_missing'],
                },
              },
            ],
          },
        ],
      },
      '/v1/payroll/payout-destinations': {
        destinations: [{ memberId: THEO.id, method: null, changedAt: null }],
      },
    });
    renderCard(true);
    const card = (await screen.findByRole('heading', { name: 'À faire' })).closest('section');
    if (card === null) throw new Error('No card');
    const line = await within(card).findByRole('link', {
      name: /^Avant ton premier versement : 3 choses à régler/u,
    });
    expect(line.getAttribute('href')).toBe('/paie/quinzaine');
    expect(line.closest('li')?.dataset['tone']).toBe('warn');
    expect(line.textContent).toContain('Le mandat de facturation n’est pas publié');
    expect(line.textContent).toContain('Pour Théo');
  });

  it('gives the reviewer of the reports their lines only, without reading the owner’s lists (ADR 0073)', async () => {
    serve({
      ...NOTHING,
      '/v1/scheduling/shift-reports': {
        reports: [sent(PAST), sent(null), sent(WITHIN)],
        shifts: [],
        accounts: [],
        members: [],
      },
    });
    renderCard(false, true);
    const card = (await screen.findByRole('heading', { name: 'À faire' })).closest('section');
    if (card === null) throw new Error('No card');
    const lines = within(card).getAllByRole('listitem');
    expect(lines.map((line) => [line.textContent, line.dataset['tone']])).toEqual([
      ['1 écart à trancherRapports', 'warn'],
      ['1 rapport à validerRapports', 'neutral'],
    ]);
    expect(
      within(card)
        .getByRole('link', { name: /^1 écart à trancher/u })
        .getAttribute('href'),
    ).toBe('/equipe/rapports');
    // What her creators wrote is read too: the reviewer is an active manager, who reads it without answering.
    expect(reads.filter((read) => !read.startsWith('/v1/scheduling/shift-reports'))).toEqual([
      '/v1/creator-messages/waiting',
    ]);
  });

  it('puts what a creator wrote to the agency in « À faire », with the owner’s answer box (trous béants n° 13)', async () => {
    const message = {
      id: '0199f2a0-0000-4000-8000-000000000901',
      creatorId: '0199f2a0-0000-7000-8000-000000000001',
      creatorName: 'Nora Vidal',
      kind: 'idea',
      body: 'Une séance au bord du lac ?',
      createdAt: '2026-11-04T09:00:00.000Z',
      answer: null,
      answeredAt: null,
    };
    serve({ ...NOTHING, '/v1/creator-messages/waiting': { messages: [message] } });
    renderCard(true);
    const card = (await screen.findByRole('heading', { name: 'À faire' })).closest('section');
    if (card === null) throw new Error('No card');
    expect(within(card).getByText('Une créatrice t’a écrit')).toBeTruthy();
    expect(within(card).getByText('Nora Vidal')).toBeTruthy();
    expect(within(card).getByText('Une idée')).toBeTruthy();
    expect(within(card).getByText('Une séance au bord du lac ?')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Répondre' }));
    expect(within(card).getByRole('form', { name: 'Répondre à Nora Vidal' })).toBeTruthy();
    cleanup();
    serve({ '/v1/creator-messages/waiting': { messages: [message] } });
    renderCard(false, true);
    const read = (await screen.findByRole('heading', { name: 'À faire' })).closest('section');
    if (read === null) throw new Error('No card');
    expect(within(read).queryByRole('button', { name: 'Répondre' })).toBeNull();
    expect(within(read).getByText('Le propriétaire répond.')).toBeTruthy();
  });
});
