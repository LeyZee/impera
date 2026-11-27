// @vitest-environment jsdom
import type { Me, TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyTrophiesPage } from './MyTrophiesPage';

import { THEO_ME } from '@/test/pay';

// Invented (ADR 0010).
const NORA_ME: Me = {
  ...THEO_ME,
  id: 'creator-user-nora',
  name: 'Nora',
  role: 'creator',
  team: null,
  teamScope: 'self',
  creatorIds: ['00000000-0000-4000-8000-0000000000aa'],
  preferences: { sounds: false },
};

const HER_CASE: TrophyCase = {
  items: [
    {
      kind: 'day_streak_7',
      family: 'medal',
      earnedAt: '2026-11-02T08:00:00.000Z',
      revealedAt: '2026-11-02T08:00:00.000Z',
      progress: null,
    },
    {
      kind: 'day_streak_14',
      family: 'medal',
      earnedAt: null,
      revealedAt: null,
      progress: { current: 9, target: 14, unit: 'day' },
    },
    {
      kind: 'delivery_streak_5',
      family: 'streak',
      earnedAt: null,
      revealedAt: null,
      progress: { current: 4, target: 5, unit: 'delivery' },
    },
    {
      kind: 'first_drop',
      family: 'trophy',
      earnedAt: '2026-10-20T08:00:00.000Z',
      revealedAt: '2026-10-20T08:00:00.000Z',
      progress: null,
    },
  ],
  streaks: [
    { kind: 'day', current: 9, best: 12 },
    { kind: 'delivery', current: 4, best: 4 },
  ],
  level: null,
};

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
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      new URL(input, 'http://localhost').pathname === '/v1/creator-space/trophy-case'
        ? Promise.resolve(Response.json(HER_CASE))
        : Promise.resolve(new Response(null, { status: 404 })),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage(user: Me): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/trophees',
    component: () => <MyTrophiesPage user={user} />,
  });
  const others = ['/moi/profil', '/moi/persona', '/moi/securite', '/moi/preferences'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/moi/trophees'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('Moi › Trophées, the creator’s', () => {
  it('shows her case with her streaks, and no level', async () => {
    renderPage(NORA_ME);
    const hero = await screen.findByRole('region', { name: '5 livraisons à l’heure' });
    expect(hero.textContent).toContain('Encore 1');
    expect(screen.getByText('Encore 5 jours')).toBeDefined();
    // Her best stays in sight after a break, never read as a loss (ADR 0108 § 9, recette 16/11 CRE-02).
    expect(hero.textContent).toContain('Série en cours : 9 jours · meilleure : 12');
    expect(hero.textContent).toContain('Livraisons à l’heure : 4 de suite');
    expect(hero.textContent).not.toContain('meilleure : 4');
    expect(screen.queryByText(/Niveau|Rang/)).toBeNull();
    expect(screen.getAllByRole('heading', { level: 3 }).map((one) => one.textContent)).toEqual([
      'Médailles',
      'Livraisons à l’heure',
      'Trophées',
    ]);
    expect(screen.getByRole('link', { name: 'Trophées' })).toBeDefined();
  });

  it('keeps her best run of deliveries beside the current one once it broke (CRE-02)', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        Response.json({
          ...HER_CASE,
          streaks: [
            { kind: 'day', current: 4, best: 16 },
            { kind: 'delivery', current: 0, best: 6 },
          ],
        }),
      ),
    );
    renderPage(NORA_ME);
    const hero = await screen.findByRole('region', { name: '5 livraisons à l’heure' });
    expect(hero.textContent).toContain('Série en cours : 4 jours · meilleure : 16');
    expect(hero.textContent).toContain('Livraisons à l’heure : 0 de suite · meilleure : 6');
  });

  it('offers a new creator her first deposit as her next trophy, not a delivery streak at nothing (CRE-14)', async () => {
    const ahead = (
      kind: string,
      family: 'medal' | 'streak' | 'trophy',
      target: number,
      unit: 'day' | 'delivery' | 'once',
    ) => ({
      kind,
      family,
      earnedAt: null,
      revealedAt: null,
      progress: { current: 0, target, unit },
    });
    const fresh: TrophyCase = {
      items: [
        ahead('day_streak_7', 'medal', 7, 'day'),
        ahead('delivery_streak_5', 'streak', 5, 'delivery'),
        ahead('first_drop', 'trophy', 1, 'once'),
        ahead('perfect_day', 'trophy', 1, 'once'),
      ],
      streaks: [
        { kind: 'day', current: 0, best: 0 },
        { kind: 'delivery', current: 0, best: 0 },
      ],
      level: null,
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        new URL(input, 'http://localhost').pathname === '/v1/creator-space/trophy-case'
          ? Promise.resolve(Response.json(fresh))
          : Promise.resolve(new Response(null, { status: 404 })),
      ),
    );
    renderPage(NORA_ME);
    expect(await screen.findByRole('region', { name: 'Premier dépôt' })).toBeDefined();
  });
});

describe('Moi › Trophées while it is read, or when the server does not answer (recette 16/11, CHT-18)', () => {
  it('shows the shapes of the case while it waits, never a blank page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderPage(NORA_ME);
    expect(await screen.findByLabelText('Chargement de la vitrine')).toBeDefined();
  });

  it('says the server does not answer, and reads again on « Réessayer »', async () => {
    let answer = (): Response => new Response(null, { status: 503 });
    const fetch = vi.fn(() => Promise.resolve(answer()));
    vi.stubGlobal('fetch', fetch);
    renderPage(NORA_ME);
    expect((await screen.findByRole('alert')).textContent).toContain('Ta vitrine n’a pas pu être lue.');
    answer = () => Response.json(HER_CASE);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('region', { name: '5 livraisons à l’heure' })).toBeDefined();
  });

  it('does the same for the chatter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 503 }))),
    );
    renderPage(THEO_ME);
    expect((await screen.findByRole('alert')).textContent).toContain('Ta vitrine n’a pas pu être lue.');
  });
});

describe('Moi › Trophées, the chatter’s rank and medals (recette 16/11, CHT-17)', () => {
  const HIS_CASE: TrophyCase = {
    items: [
      {
        kind: 'streak_10',
        family: 'streak',
        earnedAt: null,
        revealedAt: null,
        progress: { current: 8, target: 10, unit: 'shift' },
      },
    ],
    streaks: [{ kind: 'shift', current: 8, best: 12 }],
    level: null,
    nextLevel: { rank: 1, name: 'Étincelle', thresholdMinor: 10_000, currentMinor: 4_000, currency: 'EUR' },
  };
  const serve = (trophyCase: TrophyCase): void => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string) =>
        new URL(input, 'http://localhost').pathname === '/v1/rewards/my-trophy-case'
          ? Promise.resolve(Response.json(trophyCase))
          : Promise.resolve(new Response(null, { status: 404 })),
      ),
    );
  };

  it('says the first rank ahead, with its insignia still to win, while none is held', async () => {
    serve(HIS_CASE);
    renderPage(THEO_ME);
    const hero = await screen.findByRole('region', { name: 'Série de 10' });
    expect(hero.textContent).toMatch(/Premier rang\u00a0: Étincelle, à 100\s€ de net depuis ton arrivée/u);
    expect(hero.querySelector('[data-earned="false"]')).not.toBeNull();
  });

  it('says the rank held, with its insignia earned', async () => {
    serve({ ...HIS_CASE, level: { rank: 3, name: 'Charmeur' } });
    renderPage(THEO_ME);
    const hero = await screen.findByRole('region', { name: 'Série de 10' });
    expect(hero.textContent).toContain('Rang Charmeur');
    // A refund or a corrected report can take it back down: never « ne redescend jamais ».
    expect(hero.textContent).toContain('redescend si une vente est remboursée ou un rapport corrigé');
    expect(hero.textContent).not.toContain('ne redescend jamais');
    expect(hero.querySelector('[data-earned="true"]')).not.toBeNull();
  });

  it('says nothing of a rank when the agency set none', async () => {
    serve({ ...HIS_CASE, nextLevel: null });
    renderPage(THEO_ME);
    const hero = await screen.findByRole('region', { name: 'Série de 10' });
    expect(hero.textContent).not.toMatch(/rang/iu);
  });

  it('keeps the medal shelf without tiers set, and says why it is empty', async () => {
    serve(HIS_CASE);
    renderPage(THEO_ME);
    const medals = await screen.findByRole('region', { name: 'Médailles' });
    expect(medals.textContent).toContain(
      'L’agence n’a pas encore posé de paliers de prime. Tes médailles apparaîtront ici.',
    );
    expect(screen.getAllByRole('heading', { level: 3 }).map((one) => one.textContent)).toEqual([
      'Médailles',
      'Séries',
    ]);
  });
});
