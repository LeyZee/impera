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
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from '../DashboardPage';

import { AgencyPage } from './AgencyPage';
import { AGENCY_WEEK, LINA } from './fixture';
import { STEERING } from './steering-fixture';

import { apiDashboard, CREATOR, serveDashboard } from '@/test/fakes';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** The agency's figures on their route, the agent's Dashboard on its own. */
const NO_TODOS = { items: [], creators: [] };

function serve(
  creators: readonly (typeof CREATOR)[] = [CREATOR],
  answers: { steering?: { status: number; body: unknown }; todos?: unknown } = {},
): void {
  serveDashboard((url) => {
    if (url.pathname === '/v1/dashboard/agency') return { status: 200, body: AGENCY_WEEK };
    if (url.pathname === '/v1/dashboard/agency/steering')
      return answers.steering ?? { status: 200, body: STEERING };
    if (url.pathname === '/v1/dashboard/todos') return { status: 200, body: answers.todos ?? NO_TODOS };
    return { status: 200, body: apiDashboard() };
  }, creators);
}

const agencyPage = (): ReactNode => (
  <AgencyPage
    opensTracking
    selection={{ unit: 'week' }}
    onSelection={() => undefined}
    onCreator={() => undefined}
    forOwner
    reviewsReports={false}
    canAddCreator
  />
);

function show(page: () => ReactNode): void {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: '/', component: page }),
      ...[
        '/creatrices',
        '/reglages/ventes',
        '/reglages/telegram',
        '/reglages/sauvegardes',
        '/reglages/modeles-ia',
        '/suivi',
      ].map((path) => createRoute({ getParentRoute: () => root, path })),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('the agency’s Dashboard (ADR 0078)', () => {
  it('opens on the agency’s figures, the choice of a creator left to the menu’s selector (ADR 0134 § 3)', async () => {
    serve();
    show(() => (
      <AgencyPage
        opensTracking
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    expect(await screen.findByRole('heading', { name: /L’agence en chiffres/u })).toBeTruthy();
    // A title, as on every screen (recette visuelle 16/11, PIL-04).
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeTruthy();
    // No chips of its own any more: one selector, in the menu.
    expect(screen.queryByRole('radio', { name: /Toute l’agence/u })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Ce que montre le Dashboard' })).toBeNull();
  });

  it('says the AI budget in the banners’ face, without « Pour toute l’agence » on the agency’s view (ADM-26)', async () => {
    serve();
    show(() => (
      <AgencyPage
        opensTracking
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    const budget = await screen.findByRole('complementary', { name: 'Budget IA du jour, toutes créatrices' });
    expect(budget.textContent).not.toContain('Pour toute l’agence');
    expect(budget.querySelector('.db-orb')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Voir les modèles IA' }).getAttribute('href')).toBe(
      '/reglages/modeles-ia',
    );
  });

  it('asks for a first creator before any, never empty charts (DASH-13)', async () => {
    serve([]);
    show(() => (
      <AgencyPage
        opensTracking
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    expect(await screen.findByRole('link', { name: 'Aller à Créatrices' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /L’agence en chiffres/u })).toBeNull();
  });

  it('puts the figures before what the agency runs, the AI budget last (PIL-04)', async () => {
    serve();
    show(() => (
      <AgencyPage
        opensTracking
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        onCreator={() => undefined}
        forOwner
        reviewsReports={false}
        canAddCreator
      />
    ));
    const budget = await screen.findByRole('complementary', { name: 'Budget IA du jour, toutes créatrices' });
    const figures = await screen.findByRole('heading', { name: /L’agence en chiffres/u });
    expect(figures.compareDocumentPosition(budget) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('puts her agent first on a creator’s Dashboard, her figures under it, nothing of the agency’s (PIL-01, PIL-04)', async () => {
    serve();
    show(() => (
      <DashboardPage
        period="week"
        onPeriod={() => undefined}
        forOwner
        agency={{
          selection: { unit: 'week' },
          onSelection: () => undefined,
          onAgency: () => undefined,
          canOpenSettings: true,
        }}
      />
    ));
    const figures = await screen.findByRole('heading', { name: /Les chiffres de/u });
    const hero = document.querySelector('.db-hero');
    if (hero === null) throw new Error('hero');
    expect(hero.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText(/Budget IA du jour/u)).toBeNull();
  });

  it('puts her figures first on a creator’s Dashboard, one period control, no second sales panel', async () => {
    serve();
    show(() => (
      <DashboardPage
        period="week"
        onPeriod={() => undefined}
        forOwner
        agency={{
          selection: { unit: 'week' },
          onSelection: () => undefined,
          onAgency: () => undefined,
          canOpenSettings: true,
        }}
      />
    ));
    expect(await screen.findByRole('heading', { name: /Les chiffres de/u })).toBeTruthy();
    // Whose it is reads in the header: the chips are gone, the menu's selector chooses (ADR 0134 § 3).
    expect(screen.queryByRole('radio', { name: /Toute l’agence/u })).toBeNull();
    expect(screen.getAllByRole('radiogroup', { name: 'Période' })).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /Ventes lues chez/u })).toBeNull();
  });

  it('steers before the figures: the day, traffic to money, the fans it hangs on (pilotage 21/11)', async () => {
    serve();
    show(agencyPage);
    const day = await screen.findByRole('heading', { name: /Objectif du jour/u });
    const figures = await screen.findByRole('heading', { name: /L’agence en chiffres/u });
    expect(day.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 300 € a day, 273 € expected at this pace: behind by 27 €, its tag in amber.
    const verdict = await screen.findByText(/Il manquerait 27 €/u);
    expect(verdict.getAttribute('data-tone')).toBe('down');
    expect(screen.getAllByRole('button', { name: /^\d+ (oct|nov)\./u })).toHaveLength(30);
    expect(screen.getByText('Jours tenus sur les 29 derniers')).toBeTruthy();
    // The path, every step the server counted.
    const path = document.querySelector('.stg-traffic');
    expect(Array.from(path?.querySelectorAll('.nv-funnel__name') ?? [], (name) => name.textContent)).toEqual([
      'Nouveaux abonnés',
      'Ont écrit',
      '1er achat',
      'Payeurs réguliers',
    ]);
    // Five fans make 51 %: fairly concentrated; never a ten that would say 100 %.
    expect(
      screen.getByRole('heading', { name: '51 % du chiffre vient de cinq fans : assez concentré.' }),
    ).toBeTruthy();
    expect(screen.getByText('14 fans')).toBeTruthy();
    expect(screen.queryByText(/Les 10 fans/u)).toBeNull();
  });

  it('never says a share above 100 % when the buyers outnumber the new subscribers read (recette 27/11, C1)', async () => {
    serve([CREATOR], {
      steering: {
        status: 200,
        body: {
          ...STEERING,
          traffic: {
            newSubscribers: 1,
            wrote: 20,
            firstPurchase: 15,
            regular: 0,
            previous: { newSubscribers: 0, wrote: 0, firstPurchase: 0, regular: 0 },
          },
        },
      },
    });
    show(agencyPage);
    await screen.findByText('fans ont acheté pour la première fois');
    const path = document.querySelector('.stg-traffic');
    expect(Array.from(path?.querySelectorAll('.nv-funnel__rate') ?? [], (rate) => rate.textContent)).toEqual([
      '',
      '',
      '75 %',
      '0 %',
    ]);
    expect(screen.getByText(/ce ne sont pas les mêmes fans/u)).toBeTruthy();
  });

  it('names the payers who stopped, and opens the conversation of one Impera reads (ADR 0092 § 3)', async () => {
    serve();
    show(agencyPage);
    const lapsed = (await screen.findByRole('heading', { name: /Ont décroché/u })).closest('article');
    // Euros without cents, the thousands apart as the app writes them.
    expect(lapsed?.textContent).toMatch(/1\s840\u00a0€/u);
    if (lapsed === null) throw new Error('lapsed');
    expect(within(lapsed).getByText('fan_demo_baleine')).toBeTruthy();
    // Without his conversation, a line to read, not to open.
    expect(within(lapsed).queryByRole('button', { name: /fan_demo_nuit/u })).toBeNull();
    fireEvent.click(
      within(lapsed).getByRole('button', { name: 'Ouvrir la conversation de fan_demo_baleine' }),
    );
    await vi.waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Ont décroché/u })).toBeNull();
    });
  });

  it('says nothing of the steering to an account whose scope is its own', async () => {
    serve([CREATOR], { steering: { status: 403, body: { error: 'creator_forbidden' } } });
    show(agencyPage);
    await screen.findByRole('heading', { name: /L’agence en chiffres/u });
    await vi.waitFor(() => {
      expect(screen.queryByRole('heading', { name: /Objectif du jour/u })).toBeNull();
    });
  });

  it('opens on the fans who wait, a grave one in red, before any figure (grande recette 21/11, point 2)', async () => {
    const todo = {
      id: 'todo-demo-1',
      kind: 'minor',
      tone: 'bad',
      title: 'fan_demo_doute',
      why: 'Doute sur son âge : l’IA n’écrit plus.',
      at: '2026-11-21T12:00:00.000Z',
      waitingMinutes: 14,
      conversationId: '00000000-0000-4000-8000-00000000c009',
      fanId: '00000000-0000-4000-8000-00000000d009',
      creatorId: LINA,
      creatorName: 'Lina Test',
    };
    serve([CREATOR], { todos: { items: [todo], creators: [] } });
    show(agencyPage);
    const urgent = await screen.findByRole('region', { name: /Un fan t’attend/u });
    expect(urgent.getAttribute('data-tone')).toBe('bad');
    expect(within(urgent).getByText('dont 1 grave')).toBeTruthy();
    expect(within(urgent).getByText('depuis 14 min')).toBeTruthy();
    const figures = await screen.findByRole('heading', { name: /Objectif du jour/u });
    expect(urgent.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
