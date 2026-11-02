// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TodayPage } from './TodayPage';

import { ReopenProvider } from '@/reports/reopen';
import { BENIN_REGIME, documentOf, fileOf } from '@/test/contractors';
import { invoiceOf, MEMBERS, OCT2, SCHEDULING_SETTINGS, THEO, THEO_ME } from '@/test/pay';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* An invented creator (ADR 0010). Paris is UTC+1 after 25/10: 22:00Z is 23 h. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

const mine = (n: number, startsAt: string, endsAt: string): unknown => ({
  id: id(100 + n),
  creatorId: id(1),
  platformAccountId: id(11),
  memberId: id(21),
  startsAt,
  endsAt,
  templateId: null,
  stoppedAt: null,
  creatorName: 'Nora Vidal',
  platform: 'reveal',
  handle: 'nora',
  accessStartsAt: new Date(new Date(startsAt).getTime() - 15 * 60_000).toISOString(),
  accessEndsAt: new Date(new Date(endsAt).getTime() + 15 * 60_000).toISOString(),
});

function serve(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        new URL(input, 'http://localhost').pathname === '/v1/scheduling/my-shifts'
          ? new Response(JSON.stringify(body), { status: 200 })
          : new Response('null', { status: 404 }),
      ),
    ),
  );
}

function renderPage(): void {
  const root = createRootRoute({
    component: () => (
      <ReopenProvider>
        <Outlet />
      </ReopenProvider>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/aujourdhui',
    component: () => <TodayPage user={THEO_ME} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/aujourdhui'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Aujourd’hui', () => {
  it('puts the shift under way first: where, until when, and when Suivi closes', async () => {
    serve({
      current: mine(1, '2026-10-27T22:00:00Z', '2026-10-28T04:00:00Z'),
      next: mine(2, '2026-10-29T22:00:00Z', '2026-10-30T04:00:00Z'),
      ended: null,
    });
    renderPage();
    const hero = (await screen.findByRole('heading', { name: 'Nora Vidal', level: 2 })).closest('section');
    expect(hero?.textContent).toContain('En poste');
    expect(hero?.textContent).toContain('encore 4 h');
    expect(hero?.textContent).toContain('23 h – 5 h');
    expect(hero?.textContent).toContain('Tu chattes sur Reveal.');
    expect(hero?.textContent).toContain('restent ouvertes jusqu’à 5 h 15');
    expect(screen.getByRole('progressbar', { name: 'Avancée du shift' }).getAttribute('aria-valuenow')).toBe(
      '33',
    );
    expect(screen.getByRole('link', { name: 'Ouvrir Suivi' })).toBeTruthy();
    expect(screen.getByText('Ensuite').closest('section')?.textContent).toContain('Demain · 23 h – 5 h');
  });

  it('says when the next shift opens Suivi, and offers no Suivi before', async () => {
    serve({ current: null, next: mine(2, '2026-10-28T22:00:00Z', '2026-10-29T04:00:00Z'), ended: null });
    renderPage();
    const hero = (await screen.findByRole('heading', { name: 'Nora Vidal', level: 2 })).closest('section');
    expect(hero?.textContent).toContain('Prochain shift');
    expect(hero?.textContent).toContain('dans 22 h');
    expect(hero?.textContent).toContain('s’ouvriront dans Suivi à 22 h 45');
    expect(screen.queryByRole('link', { name: 'Ouvrir Suivi' })).toBeNull();
  });

  it('keeps Suivi open in the end margin of a shift just over', async () => {
    serve({ current: null, next: null, ended: mine(1, '2026-10-27T18:00:00Z', '2026-10-27T23:55:00Z') });
    renderPage();
    const hero = (await screen.findByRole('heading', { name: 'Nora Vidal', level: 2 })).closest('section');
    expect(hero?.textContent).toContain('Shift fini');
    // The corner says how long Suivi stays open, the hours below say when it ended.
    expect(hero?.textContent).toMatch(/Suivi ouvert encore 10\smin/u);
    expect(screen.getByRole('link', { name: 'Ouvrir Suivi' })).toBeTruthy();
  });

  it('says the server does not answer as the Dashboard does, with « Réessayer » (DASH-22)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('null', { status: 500 }))),
    );
    renderPage();
    // One retry first, a second later: then the page says it.
    const silent = await screen.findByRole(
      'heading',
      { name: 'Le serveur ne répond pas', level: 2 },
      { timeout: 4000 },
    );
    expect(silent.closest('.nv-silent')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('says plainly when nothing is planned', async () => {
    serve({ current: null, next: null, ended: null });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Rien pour l’instant' })).toBeTruthy();
  });

  it('says what waits on his invoices: one to answer, a document to renew (EQ-06 lot 8d)', async () => {
    const pending = invoiceOf(1, THEO, OCT2, {
      acceptance: { state: 'pending', deadline: '2026-11-09T22:59:00.000Z', reason: null },
      inclVatMinor: 71_225,
    });
    const answers: Record<string, unknown> = {
      '/v1/scheduling/my-shifts': { current: null, next: null, ended: null },
      '/v1/team/members': { members: MEMBERS },
      '/v1/scheduling/settings': SCHEDULING_SETTINGS,
      [`/v1/payroll/contractors/${THEO.id}/file`]: fileOf({
        today: '2026-12-02',
        documents: [documentOf(1)],
      }),
      '/v1/payroll/billing-regimes': { regimes: [BENIN_REGIME] },
      '/v1/payroll/invoices': { today: '2026-12-02', documents: [pending] },
    };
    const asked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) => {
        const url = new URL(input, 'http://localhost');
        if (url.pathname === '/v1/payroll/invoices') asked.push(url.search);
        const body = answers[url.pathname];
        return Promise.resolve(
          body === undefined
            ? new Response('null', { status: 404 })
            : new Response(JSON.stringify(body), { status: 200 }),
        );
      }),
    );
    renderPage();
    const card = (await screen.findByRole('heading', { name: 'À faire pour tes factures' })).closest(
      'section',
    );
    if (card === null) throw new Error('No card');
    expect(asked).toContain('?acceptance=pending');
    const invoice = within(card).getByText('TEST-2026-0001').closest('li');
    if (invoice === null) throw new Error('No invoice');
    expect(invoice.textContent).toContain('quinzaine du');
    expect(invoice.textContent).toMatch(/réponse avant le/u);
    expect(within(invoice).getByRole('link', { name: 'Accepter ou contester' }).getAttribute('href')).toBe(
      '/commissions/factures',
    );
    const certificate = await within(card).findByText('Attestation de résidence fiscale');
    const line = certificate.closest('li');
    expect(line?.getAttribute('data-remind')).toBe('true');
    expect(line?.textContent).toContain('Ton attestation se termine le 31 décembre.');
    expect(within(card).getByRole('link', { name: 'Mon dossier' }).getAttribute('href')).toBe('/moi/dossier');
  });

  it('shows no invoices’ card while nothing waits', async () => {
    serve({ current: null, next: null, ended: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Rien pour l’instant' });
    expect(screen.queryByRole('heading', { name: 'À faire pour tes factures' })).toBeNull();
  });
});
