// @vitest-environment jsdom
import { MyFiguresSchema, type MyFigures } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyFiguresBoard, MyFortnightCard } from './MyFigures';

import { NOV1, periodOf, SCHEDULING_SETTINGS, statementOf, THEO, tierSetOf } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;
const text = (): string => document.body.textContent.replace(NBSP, ' ');

/** Invented figures only (ADR 0010): Théo's fortnight on the 5th of November. */
const figuresOf = (over: Record<string, unknown> = {}): MyFigures =>
  MyFiguresSchema.parse({
    period: NOV1,
    today: '2026-11-05',
    timeZone: 'Africa/Porto-Novo',
    days: [
      { day: '2026-11-02', sales: 2, refunds: 0, nets: [{ currency: 'EUR', netMinor: 6_000 }] },
      { day: '2026-11-05', sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 2_000 }] },
    ],
    nets: [{ currency: 'EUR', netMinor: 8_000 }],
    previous: { period: '2026-10-16', days: [], toDateNets: [{ currency: 'EUR', netMinor: 10_000 }] },
    hours: {
      since: '2026-09-10',
      sales: 3,
      enough: false,
      cells: [{ weekday: 2, hour: 21, sales: 3, nets: [{ currency: 'EUR', netMinor: 8_000 }] }],
    },
    records: {
      bestDay: { day: '2026-10-20', currency: 'EUR', netMinor: 9_000 },
      bestPeriod: { period: '2026-10-16', currency: 'EUR', netMinor: 40_000 },
    },
    ...over,
  });

let figures: MyFigures;
let period: unknown;

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (url.pathname === '/v1/payroll/my-figures') return json(figures);
      if (url.pathname === '/v1/scheduling/settings') return json(SCHEDULING_SETTINGS);
      if (url.pathname === `/v1/payroll/periods/${NOV1}`)
        return period === null ? json({ error: { code: 'not_found' } }, 404) : json(period);
      return json({ items: [], nextCursor: null });
    }),
  );
}

function renderIn(Part: () => JSX.Element | null): void {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/', component: Part });
  const commissions = createRoute({
    getParentRoute: () => root,
    path: '/commissions',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, commissions]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  figures = figuresOf();
  period = null;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Commissions › Mes chiffres (CHF-01, ADR 0104 § A)', () => {
  it('montre la quinzaine jour par jour, les records et quand il vend, avec ses seuls chiffres', async () => {
    renderIn(MyFiguresBoard);
    await waitFor(() => {
      expect(screen.getByText('Ma quinzaine, jour par jour')).toBeTruthy();
    });
    expect(text()).toContain('80,00 € · 3 ventes');
    // Fifteen days, the ten ahead as a floor nobody reads.
    const bars = document.querySelectorAll('.mf-bar');
    expect(bars).toHaveLength(15);
    expect(document.querySelectorAll('.mf-bar[data-ahead="true"]')).toHaveLength(10);
    expect(document.querySelectorAll('.mf-bar[data-today="true"]')).toHaveLength(1);
    expect(text()).toContain('Meilleur jour');
    expect(text()).toContain('90,00 €');
    expect(text()).toContain('encore 70,00 € pour battre ton meilleur jour');
    expect(text()).toContain('Meilleure quinzaine');
    expect(text()).toContain('Heures de ton fuseau (Africa/Porto-Novo)');
  });

  it('dit une baisse en encre neutre, sans rouge ni alerte (§ 10)', async () => {
    renderIn(MyFiguresBoard);
    await waitFor(() => {
      expect(text()).toContain('20 % de moins qu’au même jour de ta quinzaine d’avant');
    });
    expect(document.querySelector('[data-tone="danger"], [data-tone="warn"], [role="alert"]')).toBeNull();
  });

  it('ne conclut pas sur trop peu de ventes, et conclut à partir de trente (§ 9)', async () => {
    renderIn(MyFiguresBoard);
    await waitFor(() => {
      expect(text()).toContain('Pas encore assez de ventes pour conclure : 3 ventes sur les 30 qu’il faut.');
    });
    cleanup();
    figures = figuresOf({ hours: { ...figures.hours, sales: 30, enough: true } });
    renderIn(MyFiguresBoard);
    await waitFor(() => {
      expect(text()).toContain('Tu vends le plus le mardi de 21 h à minuit : 100 % de ton net.');
    });
  });

  it('ne montre rien avant la première ligne', async () => {
    figures = figuresOf({
      days: [],
      nets: [],
      previous: null,
      hours: { since: '2026-09-10', sales: 0, enough: false, cells: [] },
      records: { bestDay: null, bestPeriod: null },
    });
    renderIn(MyFiguresBoard);
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(document.querySelector('.mf-board')).toBeNull();
  });

  it('fête le record du jour sans rien demander', async () => {
    figures = figuresOf({
      records: {
        bestDay: { day: '2026-11-05', currency: 'EUR', netMinor: 2_000 },
        bestPeriod: { period: NOV1, currency: 'EUR', netMinor: 8_000 },
      },
    });
    renderIn(MyFiguresBoard);
    await waitFor(() => {
      expect(text()).toContain('Aujourd’hui, et ça continue');
    });
    expect(text()).toContain('Celle-ci, en cours');
    expect(text()).not.toContain('pour battre ton meilleur jour');
  });
});

describe('Aujourd’hui › Ma quinzaine (CHF-01, ADR 0104 § 2 à § 4)', () => {
  it('donne son net tant qu’aucun relevé n’existe, et mène à Commissions', async () => {
    renderIn(MyFortnightCard);
    await waitFor(() => {
      expect(screen.getByText('Ma quinzaine')).toBeTruthy();
    });
    expect(text()).toContain('de net vendu à ce jour');
    expect(screen.getByRole('link', { name: 'Mes chiffres' }).getAttribute('href')).toBe('/commissions');
    expect(document.querySelector('.mf-ring')).toBeNull();
  });

  it('donne ce qu’il touche et l’anneau du prochain palier dès que le relevé existe', async () => {
    const tiers = tierSetOf(1, NOV1);
    const plain = statementOf(THEO, NOV1);
    const statement = statementOf(THEO, NOV1, {
      netMinor: 75_000,
      totalMinor: 30_000,
      rules: { ...plain.rules, bonusTiers: tiers.tiers },
    });
    period = periodOf(NOV1, [statement], { bonusTiers: tiers });
    renderIn(MyFortnightCard);
    await waitFor(() => {
      expect(text()).toContain('pour toi à ce jour, avant validation');
    });
    expect(text()).toContain('Palier Argent');
    expect(text()).toContain('encore 250,00 € de net');
    expect(document.querySelector('.mf-ring')?.getAttribute('aria-label')?.replace(NBSP, ' ')).toBe(
      'Palier Argent : encore 250,00 € de net',
    );
  });

  it('ne s’affiche pas tant qu’il n’a rien sur la quinzaine', async () => {
    figures = figuresOf({ days: [], nets: [] });
    renderIn(MyFortnightCard);
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.queryByText('Ma quinzaine')).toBeNull();
  });
});
