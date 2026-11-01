// @vitest-environment jsdom
import type { Me, PayrollPeriod } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GoalsPage } from './GoalsPage';

import { parsePaySearch } from '@/payroll/model';
import {
  BASILE,
  goalOf,
  IRIS_ME,
  MEMBERS,
  NOV1,
  NOV2,
  OCT2,
  OWNER,
  OWNER_USER,
  PAY_RULES,
  periodOf,
  SCHEDULING_SETTINGS,
  statementOf,
  summaryFor,
  THEO,
  tierSetOf,
} from '@/test/pay';

const DEC1 = '2026-12-01';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

const NBSP = /[\u00a0\u202f]/gu;
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(NBSP, ' ');
const refusal = (code: string, details: Record<string, unknown> = {}) => ({
  error: { code, message: code, details, requestId: 'req-1' },
});
/** A goal's or a set's id, made by the screen. */
const AN_ID: unknown = expect.any(String);

let periods: Record<string, PayrollPeriod>;
let answer: (path: string) => { status: number; body: unknown };
const writes: { path: string; body: unknown }[] = [];

const CLOSED = {
  period: OCT2,
  exchangeRates: [],
  closedBy: OWNER_USER,
  closedAt: '2026-11-02T08:41:00.000Z',
};
const TIERS = tierSetOf(1, '2026-10-01');

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        writes.push({ path: url.pathname, body });
        const answered = answer(url.pathname);
        return json(answered.body, answered.status);
      }
      const period = /^\/v1\/payroll\/periods\/(.+)$/u.exec(url.pathname)?.[1];
      if (period !== undefined) return json(periods[period] ?? periodOf(period, [], { window: null }));
      switch (url.pathname) {
        case '/v1/payroll/periods':
          return json({
            items: Object.values(periods)
              .filter((one) => one.statements.length > 0)
              .toSorted((a, b) => b.period.localeCompare(a.period))
              .map(summaryFor),
            nextCursor: null,
          });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        case '/v1/team/members':
          return json({ members: MEMBERS });
        case '/v1/team/pay-rules':
          return json(PAY_RULES);
        default:
          return json(null, 404);
      }
    }),
  );
}

function renderPage(user: Me, initial = '/paie/objectifs'): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/objectifs',
    validateSearch: parsePaySearch,
    component: function Page() {
      const { quinzaine } = page.useSearch();
      const navigate = page.useNavigate();
      return (
        <GoalsPage
          user={user}
          chosen={quinzaine ?? null}
          onPeriod={(period) => void navigate({ search: period === null ? {} : { quinzaine: period } })}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const valueOf = (element: HTMLElement): string => (element instanceof HTMLInputElement ? element.value : '');

const ticks = (): string[] =>
  [...document.querySelectorAll('.py-ticks li')].map(
    (one) => `${text(one)}${one.getAttribute('data-reached') === 'true' ? ' (atteint)' : ''}`,
  );

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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Thursday 5 November at midnight in Paris: five days of fifteen gone.
  vi.setSystemTime(new Date('2026-11-05T23:00:00Z'));
  writes.length = 0;
  periods = {
    [OCT2]: periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, {
          status: 'validated',
          canValidate: false,
          netMinor: 127_500,
          team: {
            netMinor: 127_500,
            collective: { reachedBps: 8_500, tier: { reachedBps: 8_000, bonusMinor: 1_000 } },
          },
        }),
      ],
      { closing: CLOSED, collectiveGoal: goalOf(OCT2), bonusTiers: TIERS },
    ),
    [NOV1]: periodOf(
      NOV1,
      [statementOf(THEO, NOV1, { netMinor: 30_000 }), statementOf(BASILE, NOV1, { netMinor: 20_000 })],
      { collectiveGoal: goalOf(NOV1), bonusTiers: TIERS },
    ),
    [NOV2]: periodOf(NOV2, [], {
      window: null,
      bonusTiers: tierSetOf(2, NOV2, {
        tiers: [{ label: 'Bronze', thresholdMinor: 60_000, bonusMinor: 1_200 }],
      }),
    }),
  };
  answer = () => ({ status: 200, body: null });
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Paie › Objectifs', () => {
  it('shows where the team is on its goal and where its pace leads, each tier on the gauge, then the tiers in force', async () => {
    renderPage(OWNER);
    expect(await screen.findByRole('heading', { name: /de net pour l’équipe$/u })).toBeTruthy();
    expect(text(screen.getByRole('heading', { name: /de net pour l’équipe$/u }))).toBe(
      '1 500,00 € de net pour l’équipe',
    );
    expect(text(document.querySelector('.py-goal__value'))).toBe('500,00 € 33 % à ce jour');
    expect(text(document.querySelector('.py-goal__top .py-quiet'))).toBe(
      'prévu le dimanche 15 novembre : 1 500,00 €, 100 %, +25,00 € par chatteur',
    );
    expect(document.querySelector('.nv-gauge')?.className).toBe('nv-gauge nv-gauge--neon');
    expect(ticks()).toEqual(['80 %+10 €', '100 %+25 €']);
    expect(text(screen.getByText(/^Posé le/u))).toBe('Posé le vendredi 30 octobre à 18 h par Charles.');

    expect(text(screen.getByRole('heading', { name: /^En vigueur/u }))).toBe(
      'En vigueur depuis la quinzaine du 1er au 15 octobre',
    );
    expect([...document.querySelectorAll('.py-tier')].map((one) => text(one))).toEqual([
      'Bronze+10,00 €à 500,00 € de net',
      'Argent+25,00 €à 1 000,00 € de net',
    ]);
    expect(text(screen.getByText(/^À partir de la quinzaine/u))).toBe(
      'À partir de la quinzaine du 16 au 30 novembre : Bronze à 600,00 €, +12,00 €.',
    );
    expect(text(screen.getByText('Quinzaine du 16 au 30 novembre').closest('summary'))).toBe(
      'Quinzaine du 16 au 30 novembrepas encore d’objectif',
    );
  });

  it('lets the owner change the goal in two steps until its 3rd day, and warns that the period has begun', async () => {
    // Monday 2 November in Paris: the period has begun, its goal may still change (PAIE-22).
    vi.setSystemTime(new Date('2026-11-02T08:00:00Z'));
    answer = () => ({ status: 201, body: goalOf(NOV1, { targetMinor: 160_000 }) });
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Changer' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog.querySelector('.tm-warn'))).toBe(
      'La quinzaine a commencé : l’équipe y travaille déjà. Son objectif change encore jusqu’au mardi 3 novembre, puis plus du tout ; préviens l’équipe de ce qui change.',
    );
    const target = within(dialog).getByLabelText('Net de l’équipe à atteindre');
    expect(valueOf(target)).toBe('1500,00');
    expect(
      within(dialog)
        .getAllByLabelText(/^Atteint à/u)
        .map((one) => valueOf(one)),
    ).toEqual(['80', '100']);
    fireEvent.change(target, { target: { value: '1 600' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(await within(dialog).findByText(/de net pour l’équipe sur la quinzaine/u))).toBe(
      '1 600,00 € de net pour l’équipe sur la quinzaine du 1er au 15 novembre : à 80 %, +10,00 € par chatteur ; à 100 %, +25,00 €.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Changer l’objectif' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toEqual([
      {
        path: '/v1/payroll/collective-goals',
        body: {
          id: AN_ID,
          period: NOV1,
          targetMinor: 160_000,
          tiers: [
            { reachedBps: 8_000, bonusMinor: 1_000 },
            { reachedBps: 10_000, bonusMinor: 2_500 },
          ],
        },
      },
    ]);
  });

  it('sets new tiers from a period that has not begun, and says why one that just began refuses them', async () => {
    let refuse = true;
    answer = () => {
      if (refuse) {
        refuse = false;
        return { status: 400, body: refusal('pay_rule_started_invalid', { period: NOV2 }) };
      }
      return { status: 201, body: tierSetOf(3, DEC1) };
    };
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveaux paliers' }));
    const dialog = await screen.findByRole('dialog');
    // The period under way has begun: the tiers start with the next one at the earliest (PAIE-22).
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((one) => [text(one), one.getAttribute('aria-checked')]),
    ).toEqual([
      ['16 – 30 novembre', 'true'],
      ['1er – 15 décembre', 'false'],
      ['16 – 31 décembre', 'false'],
      ['1er – 15 janvier', 'false'],
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer le palier 2' }));
    fireEvent.change(within(dialog).getByLabelText('Prime, palier 1'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(await within(dialog).findByText(/^À partir de la quinzaine/u))).toBe(
      'À partir de la quinzaine du 16 au 30 novembre : Bronze à 500,00 € de net, +12,00 €.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer les paliers' }));
    expect(text(await within(dialog).findByRole('alert'))).toBe(
      'La quinzaine du 16 au 30 novembre a commencé : une règle de paie part d’une quinzaine qui n’a pas commencé.',
    );

    fireEvent.click(within(dialog).getByRole('radio', { name: '1er – 15 décembre' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Enregistrer les paliers' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes.map(({ body }) => body)).toEqual([
      {
        id: AN_ID,
        fromPeriod: NOV2,
        tiers: [{ label: 'Bronze', thresholdMinor: 50_000, bonusMinor: 1_200 }],
      },
      {
        id: AN_ID,
        fromPeriod: DEC1,
        tiers: [{ label: 'Bronze', thresholdMinor: 50_000, bonusMinor: 1_200 }],
      },
    ]);
  });

  it('lets a manager read, never change', async () => {
    periods[NOV1] = periodOf(NOV1, [statementOf(THEO, NOV1)], { bonusTiers: TIERS });
    renderPage(IRIS_ME);
    expect(await screen.findByText('Pas d’objectif sur la quinzaine du 1er au 15 novembre.')).toBeTruthy();
    // Its 3rd day is gone: no goal any more this period, whoever reads.
    expect(
      screen.getByText(
        'L’objectif d’une quinzaine se pose au plus tard son 3e jour : celle-ci n’en aura pas.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Poser|Changer|Nouveaux paliers/u })).toBeNull();
    // Nothing set for the next period: nothing to read there.
    expect(screen.queryByText('Quinzaine du 16 au 30 novembre')).toBeNull();
  });

  it('lets the owner set a goal no more once its period’s 3rd day is gone', async () => {
    renderPage(OWNER);
    expect(await screen.findByRole('heading', { name: /de net pour l’équipe$/u })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Changer' })).toBeNull();
  });

  it('freezes a closed period’s goal as the statements reached it, and says so', async () => {
    renderPage(OWNER, `/paie/objectifs?quinzaine=${OCT2}`);
    expect(text(await screen.findByText(/^Close le/u))).toBe(
      'Close le lundi 2 novembre à 9 h 41 : l’objectif de cette quinzaine ne change plus.',
    );
    expect(text(document.querySelector('.py-goal__value'))).toBe('1 275,00 € 85 % atteint');
    expect(text(document.querySelector('.py-goal__top .py-quiet'))).toBe(
      'palier 80 % : +10,00 € par chatteur',
    );
    expect(ticks()).toEqual(['80 %+10 € (atteint)', '100 %+25 €']);
    expect(screen.queryByRole('button', { name: 'Changer' })).toBeNull();
  });
});
