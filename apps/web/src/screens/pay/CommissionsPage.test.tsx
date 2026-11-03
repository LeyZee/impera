// @vitest-environment jsdom
import {
  MySaleSchema,
  MySalesSchema,
  type Me,
  type MySale,
  type MySales,
  type PayrollPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommissionsPage } from './CommissionsPage';

import {
  euroLine,
  goalOf,
  LOU,
  NORA_REVEAL,
  NOV1,
  OCT1,
  OCT2,
  OWNER_USER,
  payId,
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
const AN_ID: unknown = expect.any(String);
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(NBSP, ' ');

let periods: Record<string, PayrollPeriod>;
let down: boolean;
/** A period whose own read fails, the list still answering. */
let periodDown: string | null;
let delay: number | null;
/** The member's own line of the team, all `/v1/team/members` gives a chatter (scope `self`). */
let mine: TeamMember;
const asked: string[] = [];
/** The member's own lines by period, a page per cursor (`''` for the first); a period without is empty. */
let mySales: Record<string, Record<string, MySales>>;
/** The member's lines read fail. */
let mySalesDown: boolean;
let answer: () => { status: number; body: unknown };
const writes: { path: string; body: unknown }[] = [];

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
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      asked.push(url.pathname);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        const sent: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        writes.push({ path: url.pathname, body: sent });
        const answered = answer();
        return json(answered.body, answered.status);
      }
      if (url.pathname === '/v1/payroll/my-sales') {
        if (mySalesDown)
          return json({ error: { code: 'internal', message: 'down', details: {}, requestId: 'req-1' } }, 500);
        const period = url.searchParams.get('period') ?? '';
        return json(
          mySales[period]?.[url.searchParams.get('cursor') ?? ''] ?? {
            period,
            closed: false,
            days: [],
            items: [],
            nextCursor: null,
          },
        );
      }
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
  mySales = {};
  mySalesDown = false;
  answer = () => ({ status: 200, body: null });
  writes.length = 0;
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
      {
        collectiveGoal: goalOf(NOV1),
        bonusTiers: TIERS,
        // A member reads only the share of the goal, and the one forecast of it the owner reads too (« ok A »).
        pace: {
          lateNetMinor: null,
          forecastNetMinor: null,
          goal: { reachedBps: 5_000, forecastReachedBps: 15_000 },
        },
      },
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
    expect(text(performance)).toContain('La marque est là où l’équipe finit à ce rythme.');
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

  it('says the sales read and the net of Reveal once Nora’s account is paid on it (CRM-03)', async () => {
    const onNet = euroLine({
      vatBps: 0,
      platformFeeBps: 0,
      grossMinor: 8_500,
      grossEurMinor: 8_500,
      exclVatMinor: 8_500,
      shiftReportIds: [],
      base: 'platform_net',
      countedSales: { sales: 3, refunds: 1, late: 1, lateNetMinor: 1_500 },
    });
    for (const period of [OCT2, NOV1]) {
      const one = periods[period];
      if (one === undefined) throw new Error(`No ${period}`);
      periods[period] = {
        ...one,
        statements: one.statements.map((statement) => ({ ...statement, lines: [onNet] })),
      };
    }
    renderPage();
    const path = await waitFor(() => panel('Le parcours de ton argent'));
    expect(text(path)).toContain('3 ventes lues, 1 remboursement, dont 1 après la clôture d’avant');
    expect(text(path)).toContain('Net de Reveal');
    expect(text(path)).not.toContain('Hors TVA');
    const performance = panel('Ma performance');
    // 200 € of net to go, and the net is Reveal's already: 200 € of it, nothing to take back.
    await waitFor(() => {
      expect(text(performance)).toContain(
        'Soit environ 200 € de net de Reveal d’ici le dimanche 15 novembre, pour +10,00 €.',
      );
    });
  });

  describe('« Mes ventes lues » (CRM-03 lot b4c)', () => {
    const SIGNAL = { note: 'Vendue pendant le shift de Lou', signalledAt: '2026-10-29T08:00:00.000Z' };
    const lineOf = (n: number, patch: Partial<MySale> = {}): MySale =>
      MySaleSchema.parse({
        platform: 'reveal',
        platformSaleId: `vente-${String(n)}`,
        event: 'sale',
        platformAccountId: NORA_REVEAL.id,
        currency: 'EUR',
        netMinor: 4_200,
        occurredAt: '2026-10-28T21:00:00.000Z',
        lateFrom: null,
        state: 'counted',
        signal: null,
        open: true,
        ...patch,
      });
    const onNetLine = euroLine({
      vatBps: 0,
      platformFeeBps: 0,
      grossMinor: 9_100,
      grossEurMinor: 9_100,
      exclVatMinor: 9_100,
      shiftReportIds: [],
      base: 'platform_net',
      countedSales: { sales: 2, refunds: 1, late: 0, lateNetMinor: 0 },
    });
    const onNet = (period: string) => {
      const one = periods[period];
      if (one === undefined) throw new Error(`No ${period}`);
      periods[period] = {
        ...one,
        statements: one.statements.map((statement) => ({ ...statement, lines: [onNetLine] })),
      };
    };
    const pageOf = (period: string, items: MySale[], patch: Partial<MySales> = {}): MySales =>
      MySalesSchema.parse({
        period,
        closed: false,
        items,
        nextCursor: null,
        days: [
          { day: '2026-10-30', sales: 0, refunds: 1, nets: [{ currency: 'EUR', netMinor: -1_000 }] },
          { day: '2026-10-28', sales: 2, refunds: 0, nets: [{ currency: 'EUR', netMinor: 10_100 }] },
        ],
        ...patch,
      });
    const october = [
      lineOf(3, { event: 'refund', netMinor: -1_000, occurredAt: '2026-10-30T09:15:00.000Z' }),
      lineOf(4, { state: 'excluded', signal: SIGNAL, open: false, occurredAt: '2026-10-29T10:00:00.000Z' }),
      lineOf(1, { occurredAt: '2026-10-28T21:05:00.000Z' }),
      lineOf(2, { netMinor: 5_900, occurredAt: '2026-10-28T08:00:00.000Z' }),
    ];
    const days = (inside: HTMLElement) => [...inside.querySelectorAll('details')];

    it('lists the member’s lines day by day, with hour, account, net and state, never a sale’s key', async () => {
      onNet(OCT2);
      mySales[OCT2] = { '': pageOf(OCT2, october) };
      renderPage();
      const mine = await waitFor(() => panel('Mes ventes lues'));
      expect(text(mine)).toContain('2 ventes lues · 1 remboursement · 91,00 €');
      expect(days(mine).map((day) => text(day.querySelector('summary')))).toEqual([
        'Vendredi 30 octobre1 remboursement · −10,00 €',
        'Jeudi 29 octobreRien de compté ce jour',
        'Mercredi 28 octobre2 ventes · 101,00 €',
      ]);
      // Folded but today's, and the period is over.
      expect(days(mine).map((day) => day.open)).toEqual([false, false, false]);
      const evening = within(mine).getByText('Vente de 22 h 05').closest('li');
      if (evening === null) throw new Error('No line');
      expect(text(evening)).toContain('Nora Vidal · @nora sur Reveal');
      expect(text(evening)).toContain('+42,00 €');
      expect(text(evening)).toContain('Comptée');
      expect(within(evening).getByRole('button', { name: 'Ce n’est pas ma vente' })).toBeTruthy();
      const excluded = within(mine)
        .getByText(/^Tu l’as signalée et un valideur l’a écartée/u)
        .closest('li');
      if (excluded === null) throw new Error('No line');
      expect(text(excluded)).toContain('« Vendue pendant le shift de Lou »');
      expect(within(excluded).queryByRole('button')).toBeNull();
      expect(text(mine)).not.toMatch(/vente-\d/u);
    });

    it('signals a line after reading it again, with a note, then reads the list again', async () => {
      onNet(OCT2);
      mySales[OCT2] = { '': pageOf(OCT2, october) };
      answer = () => ({
        status: 201,
        body: {
          id: payId(910),
          period: OCT2,
          platform: 'reveal',
          platformSaleId: 'vente-1',
          event: 'sale',
          memberId: THEO.id,
          revision: 1,
          kind: 'signal',
          platformAccountId: NORA_REVEAL.id,
          currency: 'EUR',
          netMinor: 4_200,
          occurredAt: '2026-10-28T21:05:00.000Z',
          note: 'Vendue pendant le shift de Lou',
          createdAt: '2026-11-05T23:00:00.000Z',
        },
      });
      renderPage();
      const mine = await waitFor(() => panel('Mes ventes lues'));
      const evening = within(mine).getByText('Vente de 22 h 05').closest('li');
      if (evening === null) throw new Error('No line');
      fireEvent.click(within(evening).getByRole('button', { name: 'Ce n’est pas ma vente' }));
      const dialog = await screen.findByRole('dialog');
      expect(text(dialog)).toContain('Ce n’est pas ta vente ?');
      expect(text(dialog)).toContain(
        'Elle reste sur ton relevé et compte pour toi tant qu’il ne l’a pas écartée.',
      );
      expect(text(dialog)).toContain('Mercredi 28 octobre · Vente de 22 h 05');
      expect(text(dialog)).toContain('Jamais le message ni le nom d’un fan.');
      expect(writes).toEqual([]);
      fireEvent.change(within(dialog).getByLabelText('Note (facultatif)'), {
        target: { value: '  Vendue pendant le shift de Lou  ' },
      });
      mySales[OCT2] = {
        '': pageOf(
          OCT2,
          october.map((one) =>
            one.platformSaleId === 'vente-1' ? { ...one, state: 'signalled', signal: SIGNAL } : one,
          ),
        ),
      };
      fireEvent.click(within(dialog).getByRole('button', { name: 'Signaler la vente' }));
      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull();
      });
      expect(writes).toEqual([
        {
          path: '/v1/payroll/sale-signals',
          body: {
            id: AN_ID,
            period: OCT2,
            platform: 'reveal',
            platformSaleId: 'vente-1',
            event: 'sale',
            kind: 'signal',
            note: 'Vendue pendant le shift de Lou',
          },
        },
      ]);
      const signalled = await waitFor(() => {
        const found = within(panel('Mes ventes lues')).getByText('Vente de 22 h 05').closest('li');
        if (found === null || !text(found).includes('Signalée')) throw new Error('Not yet');
        return found;
      });
      expect(within(signalled).getByText('Signalée').className).toContain('rp-chip--warn');
      expect(text(signalled)).toContain(
        'Tu l’as signalée : elle compte pour toi tant qu’un valideur ne l’a pas écartée.',
      );
      expect(within(signalled).getByRole('button', { name: 'Retirer le signalement' })).toBeTruthy();
    });

    it('says a refusal in the sheet and keeps the same id to send again', async () => {
      onNet(OCT2);
      mySales[OCT2] = { '': pageOf(OCT2, october) };
      answer = () => ({
        status: 409,
        body: {
          error: { code: 'pay_sale_signal_state_conflict', message: 'x', details: {}, requestId: 'req-1' },
        },
      });
      renderPage();
      const mine = await waitFor(() => panel('Mes ventes lues'));
      fireEvent.click(within(mine).getAllByRole('button', { name: 'Ce n’est pas ma vente' })[0] ?? mine);
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Signaler la vente' }));
      expect(text(await within(dialog).findByRole('alert'))).toBe(
        'Ce signalement a déjà changé : la liste est relue.',
      );
      fireEvent.click(within(dialog).getByRole('button', { name: 'Signaler la vente' }));
      await waitFor(() => {
        expect(writes).toHaveLength(2);
      });
      const [first, second] = writes.map(({ body }) => JSON.stringify(body));
      expect(first).toBe(second);
    });

    it('opens today’s lines, and gives a closed period without a gesture', async () => {
      const paidOctober = periods[OCT2];
      if (paidOctober === undefined) throw new Error('No October');
      periods[OCT2] = periodOf(
        OCT2,
        paidOctober.statements.map((one) => ({
          ...one,
          status: 'paid',
          validatedAt: '2026-11-02T09:41:00.000Z',
          payment: {
            paidOn: '2026-11-02',
            method: 'worldremit',
            reference: null,
            sentMinor: one.payableMinor,
          },
        })),
        { closing: CLOSED(OCT2, '2026-11-02T09:41:00.000Z') },
      );
      onNet(NOV1);
      // Friday 6 November at midnight in Paris: a sale at 0 h is today's, one at 23 h the day before.
      mySales[NOV1] = {
        '': pageOf(
          NOV1,
          [
            lineOf(5, { occurredAt: '2026-11-05T23:00:00.000Z' }),
            lineOf(6, { occurredAt: '2026-11-05T22:00:00.000Z' }),
          ],
          {
            days: [
              { day: '2026-11-06', sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 4_200 }] },
              { day: '2026-11-05', sales: 1, refunds: 0, nets: [{ currency: 'EUR', netMinor: 4_200 }] },
            ],
          },
        ),
      };
      renderPage();
      const mine = await waitFor(() => panel('Mes ventes lues'));
      expect(days(mine).map((day) => [text(day.querySelector('.py-mine__title')), day.open])).toEqual([
        ['Vendredi 6 novembre', true],
        ['Jeudi 5 novembre', false],
      ]);
      cleanup();
      mySales[NOV1] = {
        '': pageOf(
          NOV1,
          [
            lineOf(5, {
              occurredAt: '2026-11-05T23:00:00.000Z',
              open: false,
              state: 'signalled',
              signal: SIGNAL,
            }),
          ],
          {
            closed: true,
          },
        ),
      };
      renderPage();
      const closed = await waitFor(() => panel('Mes ventes lues'));
      expect(text(closed)).toContain('Tu l’avais signalée, la clôture l’a comptée pour toi.');
      expect(within(closed).queryByRole('button', { name: /signal|pas ma vente/u })).toBeNull();
    });

    it('reads older lines a page at a time, and says a list that cannot be read only where lines are expected', async () => {
      onNet(OCT2);
      mySales[OCT2] = {
        '': pageOf(OCT2, october.slice(0, 2), { nextCursor: 'page-2' }),
        'page-2': pageOf(OCT2, october.slice(2)),
      };
      renderPage();
      const mine = await waitFor(() => panel('Mes ventes lues'));
      expect(days(mine)).toHaveLength(2);
      fireEvent.click(within(mine).getByRole('button', { name: 'Ventes plus anciennes' }));
      await waitFor(() => {
        expect(days(panel('Mes ventes lues'))).toHaveLength(3);
      });
      expect(
        within(panel('Mes ventes lues')).queryByRole('button', { name: 'Ventes plus anciennes' }),
      ).toBeNull();

      cleanup();
      mySalesDown = true;
      renderPage();
      const down = await waitFor(() => panel('Mes ventes lues'));
      expect(text(down)).toContain('Le serveur ne répond pas');
    });

    it('shows nothing for a statement paid on reports', async () => {
      renderPage();
      await waitFor(() => panel('Le parcours de ton argent'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.queryByText('Mes ventes lues')).toBeNull();
    });
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
