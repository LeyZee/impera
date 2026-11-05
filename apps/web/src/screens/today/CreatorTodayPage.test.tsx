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

import { CreatorTodayPage } from './CreatorTodayPage';

import { agendaOf } from '@/screens/agenda/fixtures';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* Invented members and account (ADR 0010). Paris is UTC+1 after 25/10: 12:00Z is 13 h. */
const shift = (displayName: string, startsAt: string, endsAt: string) => ({
  displayName,
  handle: 'nora',
  startsAt,
  endsAt,
});

/** Text as the screen writes it, a number and its unit held together (« 5 h »); the queries by text read it with spaces. */
const nb = (text: string): string =>
  text.replace(/(\d) (h|min)/gu, '$1\u00a0$2').replace(/h (\d)/gu, 'h\u00a0$1');

function serve(body: unknown, status = 200, agenda: unknown = null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/v1/creator-space/on-duty'
          ? new Response(JSON.stringify(body), { status })
          : url.startsWith('/v1/creator-space/agenda?') && agenda !== null
            ? new Response(JSON.stringify(agenda), { status: 200 })
            : new Response('null', { status: 404 }),
      ),
    ),
  );
}

function show(): void {
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => root, path: '/', component: CreatorTodayPage });
  const agenda = createRoute({ getParentRoute: () => root, path: '/agenda', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, agenda]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Aujourd’hui, the creator’s (CR-02)', () => {
  it('says in one quiet card who answers her fans now, and who takes over', async () => {
    serve({
      current: [shift('Iris', '2026-10-28T11:00:00.000Z', '2026-10-28T17:00:00.000Z')],
      next: [
        shift('Théo', '2026-10-28T17:00:00.000Z', '2026-10-28T23:00:00.000Z'),
        shift('Iris', '2026-10-28T23:00:00.000Z', '2026-10-29T05:00:00.000Z'),
      ],
    });
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Qui répond à tes fans' })).toBeDefined();
    const lines = [...document.querySelectorAll('.sc-fans__line')].map((line) => line.textContent);
    expect(lines).toEqual([
      nb('En ce moment : Iris jusqu’à 18 h.'),
      nb('Ensuite : Théo aujourd’hui 18 h – 0 h, Iris demain 0 h – 6 h.'),
    ]);
    // One account goes without saying; no gauge, no hero: the chatter is never the point of her day.
    expect(screen.queryByText(/@nora/u)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('names her account when several are on shift for her', async () => {
    serve({
      current: [shift('Iris', '2026-10-28T11:00:00.000Z', '2026-10-28T17:00:00.000Z')],
      next: [
        { ...shift('Théo', '2026-10-28T17:00:00.000Z', '2026-10-28T23:00:00.000Z'), handle: 'nora_vip' },
      ],
    });
    show();
    expect(await screen.findByText(/sur @nora_vip/u)).toBeDefined();
    expect(screen.getByText(/sur @nora$/u)).toBeDefined();
  });

  it('says nobody answers now in one sentence: who starts, when, and until when (CREA-26)', async () => {
    serve({
      current: [],
      next: [
        shift('Théo', '2026-10-28T14:30:00.000Z', '2026-10-28T20:00:00.000Z'),
        shift('Iris', '2026-10-28T23:00:00.000Z', '2026-10-29T05:00:00.000Z'),
      ],
    });
    show();
    await screen.findByText('Théo');
    const lines = [...document.querySelectorAll('.sc-fans__line')].map((line) => line.textContent);
    // Théo is said once: the next line only has who comes after him.
    expect(lines).toEqual([
      nb('Théo à partir de 15 h 30 (dans 2 h 30), jusqu’à 21 h.'),
      nb('Ensuite : Iris demain 0 h – 6 h.'),
    ]);

    cleanup();
    serve({ current: [], next: [shift('Théo', '2026-10-29T08:00:00.000Z', '2026-10-29T12:00:00.000Z')] });
    show();
    await screen.findByText('Théo');
    expect(document.querySelector('.sc-fans__line')?.textContent).toBe(
      nb('Théo demain à partir de 9 h (dans 20 h), jusqu’à 13 h.'),
    );

    cleanup();
    serve({ current: [], next: [] });
    show();
    expect(await screen.findByText('Personne n’est prévu dans les prochaines 24 heures.')).toBeDefined();
    expect(screen.queryByText(/Ensuite/u)).toBeNull();
  });

  it('says the planning does not load, with a way to try again', async () => {
    serve({}, 500);
    show();
    expect(await screen.findByText(/Le planning n’a pas pu être lu/u)).toBeDefined();
  });
});

describe('Aujourd’hui, her day (CREA-19)', () => {
  beforeEach(() => {
    // Wednesday 4 November, 9 h 10 in Paris: the week of the fixtures.
    vi.setSystemTime(new Date('2026-11-04T08:10:00Z'));
  });

  it('opens on where her day stands, what to start with, what is next, and the way into Agenda', async () => {
    serve({ current: [], next: [] }, 200, agendaOf());
    show();
    expect(await screen.findByText('4 choses à faire')).toBeDefined();
    expect(screen.getByText('Story du matin')).toBeDefined();
    expect(screen.getByText(/Ensuite :/u).textContent).toContain('Tournage tenue rouge');
    expect(screen.getByRole('link', { name: 'Ouvrir l’agenda' }).getAttribute('href')).toBe('/agenda');
  });

  it('counts what the agency waits on her for, and takes her to her week to answer', async () => {
    serve({ current: [], next: [] }, 200, agendaOf());
    show();
    expect(await screen.findByRole('heading', { name: 'À décider' })).toBeDefined();
    expect(screen.getByText('2 propositions de l’agence attendent ta réponse cette semaine.')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Voir' }).getAttribute('href')).toBe('/agenda?vue=semaine');

    cleanup();
    localStorage.clear();
    serve({ current: [], next: [] }, 200, agendaOf({ suggestions: [] }));
    show();
    await screen.findByText('4 choses à faire');
    expect(screen.queryByRole('heading', { name: 'À décider' })).toBeNull();
  });

  it('keeps who answers her fans when her agenda cannot be read', async () => {
    serve({ current: [], next: [] });
    show();
    expect(await screen.findByText(/Ton agenda n’a pas pu être lu/u)).toBeDefined();
    expect(screen.getByText('Personne n’est prévu dans les prochaines 24 heures.')).toBeDefined();
  });
});
