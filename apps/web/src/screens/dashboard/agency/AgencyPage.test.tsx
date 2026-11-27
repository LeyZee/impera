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

/** Opens a fold of « Pour creuser » by its title: its body mounts then. */
async function dig(title: string): Promise<HTMLElement> {
  const name = await screen.findByText(title, { selector: '.nv-disclosure__title' });
  const fold = name.closest('details');
  if (fold === null) throw new Error(title);
  fold.open = true;
  fireEvent(fold, new Event('toggle'));
  return fold;
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
    expect(await screen.findByRole('heading', { name: /L’argent/u })).toBeTruthy();
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
    expect(screen.queryByRole('heading', { name: /L’argent/u })).toBeNull();
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
    const figures = await screen.findByRole('heading', { name: /L’argent/u });
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

  it('says the money first, then folds the rest on lines that already answer (maquette du 27/11)', async () => {
    serve();
    show(agencyPage);
    const money = await screen.findByRole('heading', { name: /L’argent/u });
    const folds = await screen.findByRole('heading', { name: /Pour creuser/u });
    expect(money.compareDocumentPosition(folds) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Today read in the steering, not a second objective of the day.
    expect(screen.queryByRole('heading', { name: /Objectif du jour/u })).toBeNull();
    expect(await screen.findByText('Aujourd’hui')).toBeTruthy();
    // Each fold answers without opening; its body mounts on demand.
    expect(document.querySelector('.stg-traffic')).toBeNull();
    const traffic = await dig('Du trafic à l’argent');
    const path = traffic.querySelector('.stg-traffic');
    expect(Array.from(path?.querySelectorAll('.nv-funnel__name') ?? [], (name) => name.textContent)).toEqual([
      'Nouveaux abonnés',
      'Ont écrit',
      '1er achat',
      'Payeurs réguliers',
    ]);
    // Five fans make 51 %: fairly concentrated; never a ten that would say 100 %.
    await dig('Gros fans');
    expect(
      screen.getByRole('heading', { name: '51 % du chiffre vient de cinq fans : assez concentré.' }),
    ).toBeTruthy();
    expect(screen.getByText('14 fans')).toBeTruthy();
    expect(screen.queryByText(/Les 10 fans/u)).toBeNull();
  });

  it('names the quiet blocks in one line instead of empty cards', async () => {
    serve();
    show(agencyPage);
    const quiet = await screen.findByText(/Se montreront quand ils auront de quoi dire/u);
    expect(quiet.closest('p')?.textContent).toMatch(/fans brûlés/u);
  });

  it('says no pace without an objective, and offers to set the month’s on the money itself (audit 27/11)', async () => {
    serveDashboard(
      (url) => {
        if (url.pathname === '/v1/dashboard/agency')
          return { status: 200, body: { ...AGENCY_WEEK, span: { ...AGENCY_WEEK.span, unit: 'month' } } };
        if (url.pathname === '/v1/dashboard/agency/steering') return { status: 200, body: STEERING };
        if (url.pathname === '/v1/dashboard/todos') return { status: 200, body: NO_TODOS };
        return { status: 200, body: apiDashboard() };
      },
      [CREATOR],
    );
    show(agencyPage);
    const set = await screen.findByRole('button', { name: 'Fixer l’objectif du mois' });
    // Never « Dans les clous » or « En retard » against nothing.
    expect(screen.queryByText(/Dans les clous|En retard/u)).toBeNull();
    expect(document.querySelector('.own-pace')).toBeNull();
    fireEvent.click(set);
    await vi.waitFor(() => {
      expect(document.querySelector<HTMLDetailsElement>('#creuser-creators')?.open).toBe(true);
    });
  });

  it('reads the month against its objective: the pill, the bar and the end at this pace', async () => {
    const objectives = {
      month: '2026-11-01',
      daysGone: 6,
      days: 30,
      creators: [],
      objectiveMinor: 600_000,
      revenueMinor: 184_600,
      projectedMinor: 923_000,
    };
    serveDashboard(
      (url) => {
        if (url.pathname === '/v1/dashboard/agency')
          return {
            status: 200,
            body: { ...AGENCY_WEEK, span: { ...AGENCY_WEEK.span, unit: 'month' }, objectives },
          };
        if (url.pathname === '/v1/dashboard/agency/steering') return { status: 200, body: STEERING };
        if (url.pathname === '/v1/dashboard/todos') return { status: 200, body: NO_TODOS };
        return { status: 200, body: apiDashboard() };
      },
      [CREATOR],
    );
    show(agencyPage);
    expect(await screen.findByText('Dans les clous')).toBeTruthy();
    expect(document.querySelector('.own-pace')?.getAttribute('data-tone')).toBe('up');
    expect(screen.queryByRole('button', { name: 'Fixer l’objectif du mois' })).toBeNull();
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
    const traffic = await dig('Du trafic à l’argent');
    await screen.findByText('fans ont acheté pour la première fois');
    const path = traffic.querySelector('.stg-traffic');
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
    await dig('Gros fans');
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
    await screen.findByRole('heading', { name: /L’argent/u });
    await screen.findByRole('heading', { name: /Pour creuser/u });
    expect(screen.queryByText('Du trafic à l’argent')).toBeNull();
    expect(screen.queryByText('Gros fans')).toBeNull();
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
    const figures = await screen.findByRole('heading', { name: /L’argent/u });
    expect(urgent.compareDocumentPosition(figures) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
