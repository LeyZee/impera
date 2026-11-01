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
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TodayPage } from './TodayPage';

import { ReopenProvider } from '@/reports/reopen';

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
  const page = createRoute({ getParentRoute: () => root, path: '/aujourdhui', component: TodayPage });
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
});
