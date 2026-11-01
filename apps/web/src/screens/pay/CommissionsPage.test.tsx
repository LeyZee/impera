// @vitest-environment jsdom
import type { Me, PayrollPeriod, TeamMember } from '@nirvana/contracts';
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

import { CommissionsPage } from './CommissionsPage';

import {
  goalOf,
  LOU,
  NORA_REVEAL,
  NOV1,
  OCT1,
  OCT2,
  OWNER_USER,
  periodOf,
  SCHEDULING_SETTINGS,
  statementOf,
  summaryFor,
  THEO,
  THEO_ME,
  tierSetOf,
} from '@/test/pay';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

const NBSP = /[\u00a0\u202f]/gu;
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(NBSP, ' ');

let periods: Record<string, PayrollPeriod>;
let down: boolean;
/** A period whose own read fails, the list still answering. */
let periodDown: string | null;
let delay: number | null;
/** The member's own line of the team, all `/v1/team/members` gives a chatter (scope `self`). */
let mine: TeamMember;
const asked: string[] = [];

const TIERS = tierSetOf(1, OCT1);
const PAID_OCT1 = statementOf(THEO, OCT1, {
  status: 'paid',
  canValidate: false,
  validatedAt: '2026-10-16T08:41:00.000Z',
  validatedBy: OWNER_USER,
  paidAt: '2026-10-16T15:00:00.000Z',
  paidBy: OWNER_USER,
  payment: { paidOn: '2026-10-16', method: 'worldremit', reference: 'WR-2610-0388', sentMinor: 2_125 },
});
const CLOSED = (period: string, closedAt: string) => ({
  period,
  exchangeRates: null,
  closedBy: null,
  closedAt,
});

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      asked.push(url.pathname);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (down && url.pathname.startsWith('/v1/payroll'))
        return json({ error: { code: 'internal', message: 'down', details: {}, requestId: 'req-1' } }, 500);
      const period = /^\/v1\/payroll\/periods\/(.+)$/u.exec(url.pathname)?.[1];
      if (period !== undefined && period === periodDown)
        return json({ error: { code: 'internal', message: 'down', details: {}, requestId: 'req-1' } }, 500);
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
        case '/v1/team/members':
          return json({ members: [mine] });
        case '/v1/payroll/settings':
          return json({ minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: delay });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        case '/v1/scheduling/shift-reports':
          return json({ reports: [], shifts: [], accounts: [NORA_REVEAL], members: [] });
        default:
          return json(null, 404);
      }
    }),
  );
}

function renderPage(user: Me = THEO_ME): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/commissions',
    component: () => <CommissionsPage user={user} />,
  });
  const planning = createRoute({ getParentRoute: () => root, path: '/planning', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, planning]),
    history: createMemoryHistory({ initialEntries: ['/commissions'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const panel = (eyebrow: string): HTMLElement => {
  const found = screen
    .getAllByText(eyebrow, { selector: '.nv-eyebrow' })
    .map((one) => one.closest('section'))
    .find((one) => one !== null);
  if (found === undefined) throw new Error(`No panel ${eyebrow}`);
  return found;
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // Friday 6 November at midnight in Paris: five days of fifteen gone.
  vi.setSystemTime(new Date('2026-11-05T23:00:00Z'));
  down = false;
  periodDown = null;
  delay = null;
  mine = THEO;
  asked.length = 0;
  periods = {
    [OCT1]: periodOf(OCT1, [PAID_OCT1], { closing: CLOSED(OCT1, '2026-10-16T08:41:00.000Z') }),
    [OCT2]: periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, {
          canValidate: false,
          netMinor: 98_000,
          payableMinor: 3_120,
          totalMinor: 3_120,
        }),
      ],
      { bonusTiers: TIERS },
    ),
    [NOV1]: periodOf(
      NOV1,
      [
        statementOf(THEO, NOV1, {
          canValidate: false,
          netMinor: 30_000,
          rules: {
            commissionRateBps: 2_500,
            teamShareBps: null,
            bonusTiers: TIERS.tiers,
            collectiveGoal: { targetMinor: 150_000, tiers: goalOf(NOV1).tiers },
            minimumPayoutMinor: 1_500,
            exchangeRates: [],
            final: false,
          },
          team: { netMinor: 75_000, collective: { reachedBps: 5_000, tier: null } },
        }),
      ],
      { collectiveGoal: goalOf(NOV1), bonusTiers: TIERS },
    ),
  };
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CommissionsPage', () => {
  it('opens on the money on its way, and says what is left in the period under way, never the team’s amounts', async () => {
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Ce que tu vas toucher' });
    expect(text(hero)).toContain('En validation');
    expect(text(hero)).toContain('depuis le dim. 1er nov.');
    // The amount names its period beside its stage: the column on the right speaks of another one.
    expect(text(hero.querySelector('.py-mehero__period'))).toBe('16 – 31 octobre');
    expect(text(hero)).toContain('31,20 €');
    // Théo lives in Benin: what it is in CFA francs, at the fixed parity, as a guide; the euro stays what pay computes.
    await waitFor(() => {
      expect(text(hero)).toContain('≈ 20 466 FCFA, avant frais WorldRemit');
    });
    expect(text(hero)).toContain('L’agence valide, puis le versement suit.');
    expect(text(document.querySelector('.nv-eyebrow'))).toBe('Quinzaine du 16 au 31 octobre');

    expect(text(panel('Le parcours de ton argent'))).toContain('Ta commission');
    // One amount, one name: the path ends on the hero's words.
    expect(text(panel('Le parcours de ton argent').querySelector('.py-lines__total dt'))).toBe(
      'Ce que tu vas toucher',
    );

    const performance = panel('Ma performance');
    expect(
      within(performance).getByRole('heading', { name: 'Quinzaine du 1er au 15 novembre' }),
    ).toBeDefined();
    await waitFor(() => {
      expect(text(performance)).toContain('Palier Bronze : encore 200,00 € de net');
    });
    // 200 € of net, back through the fee and the VAT on Nora's Reveal: 282,36 € of sales, rounded up.
    expect(text(performance)).toContain(
      'Soit environ 283 € de ventes sur Reveal d’ici le dimanche 15 novembre, pour +10,00 €.',
    );
    expect(text(performance)).toContain('Objectif de l’équipe : 50 %');
    expect(text(performance)).toContain('À 80 %, +10,00 € pour toi ; à 100 %, +25,00 €.');
    // The team's net is the agency's figure: never said to a chatter.
    expect(text(performance)).not.toContain('750,00');
    expect(text(performance)).not.toContain('1 500,00');

    const rows = within(panel('Mes relevés')).getAllByRole('button');
    expect(rows.map(text)).toEqual([
      '1er – 15 novembre300,00 € de net à ce jourEn cours21,25 €à ce jour',
      '1er – 15 octobre85,00 € de netPayé21,25 €touché',
    ]);
    // A chatter reads their own line of the team, for their country, and never its rules.
    expect(asked).not.toContain('/v1/team/pay-rules');
  });

  it('says the payout delay the owner announced (PAIE-32)', async () => {
    delay = 3;
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Ce que tu vas toucher' });
    await waitFor(() => {
      expect(text(hero)).toContain(
        'L’agence valide, puis le versement suit, en général 3 jours ouvrés après la validation.',
      );
    });
  });

  it('gives the amount in CFA francs only to a member of the CFA franc zone', async () => {
    // Théo moved to Madagascar: he will never receive francs CFA.
    mine = { ...THEO, country: LOU.country };
    renderPage();
    const hero = await screen.findByRole('region', { name: 'Ce que tu vas toucher' });
    await waitFor(() => {
      expect(asked).toContain('/v1/team/members');
    });
    expect(text(hero)).toContain('31,20 €');
    expect(text(hero)).not.toContain('FCFA');
  });

  it('says the statement is out of date when pay could not compute the period, never whose rate lacks', async () => {
    // A colleague lacks a rate: the server gives a member none of the others' ids.
    const october = periods[OCT2];
    if (october === undefined) throw new Error('no period');
    periods[OCT2] = {
      ...october,
      blocked: { code: 'commission_rate_missing_conflict', memberIds: [], since: '2026-11-02T09:00:00.000Z' },
    };
    renderPage();
    const title = await screen.findByText(
      'Ton relevé n’est plus à jour : le calcul de la quinzaine est bloqué.',
    );
    const notice = title.closest('.rp-notice');
    expect(notice?.getAttribute('data-tone')).toBe('warn');
    expect(text(notice)).toBe(
      'Ton relevé n’est plus à jour : le calcul de la quinzaine est bloqué.Il manque un taux de commission dans l’équipe pour cette quinzaine. Le propriétaire est prévenu dans sa paie ; le calcul reprendra seul une fois réglé. Le montant ci-dessous est celui du dernier calcul réussi.',
    );
    const hero = screen.getByRole('region', { name: 'Ce que tu vas toucher' });
    expect(hero.getAttribute('data-stale')).toBe('true');
    expect(text(hero)).toContain('Plus à jour');
    expect(text(hero)).not.toContain('En validation');
  });

  it('opens a past statement in the second person, paid in the past tense', async () => {
    renderPage();
    const past = await within(await waitFor(() => panel('Mes relevés'))).findByRole('button', {
      name: /^1er – 15 octobre/u,
    });
    fireEvent.click(past);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: '1er – 15 octobre 2026' })).toBeDefined();
    await waitFor(() => {
      expect(text(dialog)).toContain('Ce que tu as touché');
    });
    expect(text(dialog)).toContain('Payé le vendredi 16 octobre par WorldRemit, référence WR-2610-0388.');
    expect(text(dialog)).toContain('Ta commission');
    expect(text(dialog)).toContain('Validé le vendredi 16 octobre à 10 h 41.');
    expect(text(dialog)).not.toMatch(/fiche de paie|salaire/iu);
    fireEvent.click(within(dialog).getByText('Fermer', { selector: '.py-dialog__foot button' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('opens on the period under way once nothing is on its way, and spares a manager the team’s goal', async () => {
    const october = periods[OCT2];
    if (october === undefined) throw new Error('No October');
    periods[OCT2] = periodOf(
      OCT2,
      october.statements.map((one) => ({
        ...one,
        status: 'paid',
        validatedAt: '2026-11-02T09:41:00.000Z',
        payment: { paidOn: '2026-11-02', method: 'worldremit', reference: null, sentMinor: one.payableMinor },
      })),
      { closing: CLOSED(OCT2, '2026-11-02T09:41:00.000Z') },
    );
    renderPage({ ...THEO_ME, team: { role: 'manager', status: 'on_leave' } });
    const hero = await screen.findByRole('region', { name: 'Ce que tu touches à ce jour' });
    expect(text(hero)).toContain('En cours');
    // Not the chatter's gesture: the agency validates.
    expect(text(hero)).toContain('validation par l’agence à partir du lun. 16 nov.');
    expect(text(hero)).toContain('Calculé le lun. 2 nov. à 10 h 07 sur tes rapports validés.');
    expect(text(document.querySelector('.nv-eyebrow'))).toBe('Quinzaine du 1er au 15 novembre');
    const performance = panel('Ma performance');
    expect(within(performance).queryByRole('heading')).toBeNull();
    await waitFor(() => {
      expect(text(performance)).toContain('Palier Bronze');
    });
    expect(text(performance)).not.toContain('Objectif de l’équipe');
    expect(within(panel('Mes relevés')).getAllByRole('button').map(text)[0]).toContain('Payé31,20 €touché');
  });

  it('says of a period carried over what went on the next one, never « 0,00 € touché »', async () => {
    periods[OCT1] = periodOf(
      OCT1,
      [
        statementOf(THEO, OCT1, {
          status: 'validated',
          canValidate: false,
          validatedAt: '2026-10-16T08:41:00.000Z',
          totalMinor: 667,
          carryOverOutMinor: 667,
          payableMinor: 0,
        }),
      ],
      { closing: CLOSED(OCT1, '2026-10-16T08:41:00.000Z') },
    );
    // Its own read fails: the row says it from the list's sum (`carriedMinor`, #295), never « 0,00 € touché ».
    periodDown = OCT1;
    renderPage();
    const panelOf = await waitFor(() => panel('Mes relevés'));
    const carried = await within(panelOf).findByRole('button', { name: /^1er – 15 octobre/u });
    expect(text(carried)).toContain('Reporté6,67 €reporté sur le 16 – 31 octobre');
    expect(text(carried)).not.toContain('touché');
  });

  it('tells a new chatter where their first statement comes from', async () => {
    periods = {};
    renderPage();
    expect(
      await screen.findByText('Ton premier relevé arrive avec ton premier rapport validé.'),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Voir mon planning' }).getAttribute('href')).toBe('/planning');
  });

  it('says a server that does not answer, never an empty page', async () => {
    down = true;
    renderPage();
    // The list tries twice more before it says so.
    await waitFor(
      () => {
        expect(
          screen.getByText('Le serveur ne répond pas : la liste de tes relevés n’a pas pu être lue.'),
        ).toBeDefined();
      },
      { timeout: 5_000 },
    );
    expect(screen.queryByText('Ton premier relevé arrive avec ton premier rapport validé.')).toBeNull();
    down = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('region', { name: 'Ce que tu vas toucher' })).toBeDefined();
  });
});
