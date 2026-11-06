// @vitest-environment jsdom
import type { HeldSale, Me, PayrollPeriod, TeamMember } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PeriodPage } from './PeriodPage';

import { parsePaySearch } from '@/payroll/model';
import { HoldProvider } from '@/reports/Hold';
import {
  adjustmentOf,
  BASILE,
  euroLine,
  goalOf,
  heldSaleOf,
  IRIS,
  IRIS_ME,
  LEA_ONLYFANS,
  LOU,
  MEMBERS,
  NORA_REVEAL,
  NOV1,
  OCT1,
  OCT2,
  OWNER,
  OWNER_USER,
  PAY_RULES,
  payId,
  periodOf,
  SCHEDULING_SETTINGS,
  statementOf,
  summaryFor,
  THEO,
} from '@/test/pay';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

const NBSP = /[\u00a0\u202f]/gu;
const refusal = (code: string) => ({ error: { code, message: code, details: {}, requestId: 'req-1' } });
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(NBSP, ' ');
/** An adjustment's id, made by the screen. */
const AN_ID: unknown = expect.any(String);

let periods: Record<string, PayrollPeriod | 'down'>;
let reports: unknown[];
/** The sales each period holds or a decision settles (CRM-03 lot b4b); `'down'` answers a server error. */
let held: Record<string, HeldSale[] | 'down'>;
let rules: unknown;
/** The latest dollar rate the daily job read. */
let usd: unknown;
/** What a `POST` answers, from its path. */
let answer: (path: string) => { status: number; body: unknown };
const writes: { path: string; body: unknown }[] = [];
/** When set, a period is answered only once it resolves: a read the screen waits on. */
let gate: Promise<void> | null;
/** The agency's settings answer a server error (recette EQP-05). */
let settingsDown: boolean;
let team: readonly TeamMember[];

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
      const holding = /^\/v1\/payroll\/periods\/([^/]+)\/held-sales$/u.exec(url.pathname)?.[1];
      if (holding !== undefined) {
        const sales = held[holding] ?? [];
        if (sales === 'down') return json({ error: { code: 'internal', message: 'down' } }, 500);
        return json({ period: holding, sales });
      }
      const period = /^\/v1\/payroll\/periods\/(.+)$/u.exec(url.pathname)?.[1];
      if (period !== undefined) {
        const reply = () => {
          const found = periods[period];
          if (found === 'down') return json({ error: { code: 'internal', message: 'down' } }, 500);
          return json(found ?? periodOf(period, [], { window: null }));
        };
        return gate === null ? reply() : gate.then(reply);
      }
      switch (url.pathname) {
        case '/v1/scheduling/settings':
          if (settingsDown) return json({ error: { code: 'internal', message: 'down' } }, 500);
          return json(SCHEDULING_SETTINGS);
        case '/v1/payroll/periods':
          return json({
            items: Object.values(periods)
              .filter((one): one is PayrollPeriod => one !== 'down' && one.statements.length > 0)
              .toSorted((a, b) => b.period.localeCompare(a.period))
              .map(summaryFor),
            nextCursor: null,
          });
        case '/v1/team/members':
          return json({ members: team });
        case '/v1/team/pay-rules':
          return json(rules);
        case '/v1/payroll/exchange-rates':
          return json({ usd });
        case '/v1/scheduling/shift-reports':
          return json({ reports, shifts: [], accounts: [], members: [] });
        default:
          return json(null, 404);
      }
    }),
  );
}

function renderPage(user: Me, initial = '/paie/quinzaine'): void {
  const root = createRootRoute({
    component: () => (
      <HoldProvider>
        <Outlet />
      </HoldProvider>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/quinzaine',
    validateSearch: parsePaySearch,
    component: function Page() {
      const { quinzaine, membre } = page.useSearch();
      const navigate = page.useNavigate();
      return (
        <PeriodPage
          user={user}
          chosen={quinzaine ?? null}
          member={membre ?? null}
          onPeriod={(period) => void navigate({ search: period === null ? {} : { quinzaine: period } })}
        />
      );
    },
  });
  const file = createRoute({
    getParentRoute: () => root,
    path: '/equipe/membres/$memberId/dossier',
    component: () => null,
  });
  const billing = createRoute({
    getParentRoute: () => root,
    path: '/reglages/facturation',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, file, billing]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const row = (name: string): HTMLElement => {
  const found = screen.getByRole('button', { name }).closest('li');
  if (found === null) throw new Error(`No row for ${name}`);
  return found;
};

const PAID = {
  status: 'paid',
  canValidate: false,
  paidAt: '2026-10-17T09:00:00.000Z',
  paidBy: OWNER_USER,
  payment: { paidOn: '2026-10-17', method: 'worldremit', reference: null, sentMinor: 2_125 },
};

/** The second half of October, ended, nobody validated yet: Lou is under the minimum. */
const endedOctober = (patch: Partial<Record<keyof PayrollPeriod, unknown>> = {}, irisValidates = true) =>
  periodOf(
    OCT2,
    [
      statementOf(THEO, OCT2, {
        netMinor: 120_000,
        commissionMinor: 30_000,
        totalMinor: 30_000,
        payableMinor: 30_000,
      }),
      statementOf(BASILE, OCT2),
      statementOf(LOU, OCT2, { totalMinor: 1_200, carryOverOutMinor: 1_200, payableMinor: 0 }),
      statementOf(IRIS, OCT2, { canValidate: irisValidates }),
    ],
    patch,
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
  // Monday 2 November, 10:00 in Paris: the second half of October has ended.
  vi.setSystemTime(new Date('2026-11-02T09:00:00Z'));
  writes.length = 0;
  gate = null;
  settingsDown = false;
  team = MEMBERS;
  reports = [];
  held = {};
  rules = PAY_RULES;
  periods = {
    [OCT1]: periodOf(OCT1, [statementOf(THEO, OCT1, { netMinor: 100_000, ...PAID })], {
      closing: {
        period: OCT1,
        exchangeRates: [],
        closedBy: OWNER_USER,
        closedAt: '2026-10-16T08:00:00.000Z',
      },
    }),
    [OCT2]: endedOctober(),
    [NOV1]: periodOf(NOV1, [statementOf(THEO, NOV1)]),
  };
  answer = () => ({ status: 200, body: null });
  usd = null;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Paie › Quinzaine', () => {
  it('opens the period to validate, what to pay first, every draft checked, a carry-over its one amber mark', async () => {
    renderPage(OWNER);
    // Nothing validated yet: the amount says it is owed only once validated, never as owed already.
    expect(text(await screen.findByText('À verser une fois validé')).length).toBeGreaterThan(0);
    // The period is the page's title, alone in its name: the arrows sit in the page's actions.
    expect(screen.getByRole('heading', { level: 1, name: '16 – 31 octobre 2026' })).toBeTruthy();
    expect(within(screen.getByRole('heading', { level: 1 })).queryByRole('button')).toBeNull();
    expect(screen.getByRole('button', { name: 'Quinzaine précédente' })).toBeTruthy();
    expect(text(screen.getByText('À verser une fois validé').nextElementSibling)).toBe('342,50 €');
    expect(screen.getByRole('button', { name: 'Valider (4)' })).toBeTruthy();
    expect(text(row('Lou'))).toContain(
      'Sous le minimum de 15,00 € : 12,00 € iront sur la quinzaine suivante une fois le relevé validé.',
    );
    // Not « Reporté » before it is validated: under the minimum, amber, its total and where it would go.
    expect(within(row('Lou')).getByText('Sous le minimum').className).toContain('rp-chip--warn');
    expect(within(row('Lou')).queryByText('Reporté')).toBeNull();
    expect(text(row('Lou'))).toContain('total 12,00 € → irait en report');
    // Every row is to validate, as the header says: no row repeats it, and each amount says what it is.
    expect(within(row('Théo')).queryByText('À valider')).toBeNull();
    expect(within(row('Théo')).getByText('à verser')).toBeTruthy();
    // No change against the period before on a row: the statement says it, with what it compares to.
    expect(row('Théo').querySelector('.nv-delta')).toBeNull();
    expect(screen.getByText(/Le premier relevé validé clôt la quinzaine pour toute l’équipe/u)).toBeTruthy();
    // Ended since the day after its last one, at 0 h: never « le samedi 31 octobre à minuit » (recette EQP-13).
    expect(screen.getByText('depuis le dimanche 1er novembre à 0 h')).toBeTruthy();
  });

  it('counts a draft under zero apart from one under the minimum, with the words of their chips', async () => {
    periods[OCT2] = periodOf(OCT2, [
      statementOf(THEO, OCT2),
      statementOf(BASILE, OCT2, { totalMinor: 1_200, carryOverOutMinor: 1_200, payableMinor: 0 }),
      statementOf(LOU, OCT2, { totalMinor: -500, carryOverOutMinor: -500, payableMinor: 0 }),
    ]);
    renderPage(OWNER);
    const hero = (await screen.findByText('À verser une fois validé')).closest('.py-hero');
    expect(text(hero)).toContain('1 sous le minimum');
    expect(text(hero)).toContain('1 sous zéro');
    expect(within(row('Lou')).getByText('Sous zéro')).toBeTruthy();
  });

  it('says of a closed period what is left to send, apart from what went and what waits, each amount named', async () => {
    const validatedAt = '2026-11-02T08:41:00.000Z';
    periods[OCT2] = periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, {
          status: 'paid',
          payableMinor: 10_000,
          totalMinor: 10_000,
          validatedAt,
          payment: { paidOn: '2026-11-03', method: 'worldremit', reference: null, sentMinor: 10_000 },
        }),
        statementOf(BASILE, OCT2, {
          status: 'validated',
          payableMinor: 20_000,
          totalMinor: 20_000,
          validatedAt,
        }),
        statementOf(LOU, OCT2, { payableMinor: 5_000, totalMinor: 5_000 }),
      ],
      { closing: { period: OCT2, exchangeRates: [], closedBy: OWNER_USER, closedAt: validatedAt } },
    );
    renderPage(OWNER);
    // Only the validated statements not paid yet: never the drafts, never what already went.
    expect(text((await screen.findByText('Reste à envoyer')).nextElementSibling)).toBe('200,00 €');
    expect(text(screen.getByText(/^Déjà versé/u))).toBe(
      'Déjà versé 100,00 € · 50,00 € pas encore validé (1 relevé)',
    );
    expect(text(row('Théo'))).toContain('versé le 3 nov.');
    expect(within(row('Théo')).getByText('Payé').className).toContain('rp-chip--ok');
    // Validated with money still to send waits: not the tone of what is paid.
    expect(within(row('Basile')).getByText('Validé').className).toContain('rp-chip--wait');
    expect(text(row('Basile'))).toContain('à verser');
    expect(text(row('Lou'))).toContain('à verser, une fois validé');
    expect(within(row('Lou')).getByText('À valider')).toBeTruthy();
  });

  it('says how old the last dollar rate is, that the amount is provisional, and to warn once it stops coming', async () => {
    const dollars = euroLine({ currency: 'USD', rateMicros: 861_200 });
    periods[OCT2] = periodOf(OCT2, [statementOf(THEO, OCT2, { lines: [dollars] })]);
    usd = {
      currency: 'USD',
      day: '2026-10-22',
      rateMicros: 861_200,
      source: 'ecb',
      fetchedAt: '2026-10-22T15:00:00.000Z',
    };
    renderPage(OWNER);
    const notice = await screen.findByText(/^Dernier lu/u);
    // Monday 2 November: six working days without a rate since Thursday 22 October.
    expect(text(notice)).toBe(
      'Dernier lu : 1 $ = 0,8612 € le jeu. 22 oct. Le taux n’arrive plus depuis plus de deux jours ouvrés : la lecture des taux de la BCE est en panne.',
    );
    expect(screen.getByText(/^Provisoire : les ventes en dollars/u)).toBeTruthy();
    // A manager cannot repair it: the notice says whom to warn.
    cleanup();
    renderPage(IRIS_ME);
    expect(text(await screen.findByText(/^Dernier lu/u))).toMatch(/en panne\. Préviens le propriétaire\.$/u);
  });

  it('counts in the closing the sales read on the platform’s net, and where one read after it goes (CRM-03)', async () => {
    const onNet = euroLine({
      vatBps: 0,
      platformFeeBps: 0,
      grossMinor: 8_500,
      grossEurMinor: 8_500,
      exclVatMinor: 8_500,
      shiftReportIds: [],
      base: 'platform_net',
      countedSales: { sales: 3, refunds: 1, late: 0, lateNetMinor: 0 },
    });
    periods[OCT2] = periodOf(OCT2, [statementOf(THEO, OCT2, { lines: [onNet] })]);
    renderPage(OWNER);
    expect(text(await screen.findByText(/^Le premier relevé validé clôt la quinzaine/u))).toBe(
      'Le premier relevé validé clôt la quinzaine pour toute l’équipe. Un rapport validé ou une vente lue ensuite ira sur la quinzaine du 1er au 15 novembre.',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Valider (1)' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Ventes comptées');
    expect(text(dialog.querySelector('.py-lines'))).toMatch(/comptés pour un membre4/u);
    // No report on a period on the platform's net alone: no line that says 0 of them.
    expect(text(dialog)).not.toContain('Rapports comptés');
    expect(text(dialog)).toContain(
      'Un rapport validé ou une vente lue après la clôture ira sur la quinzaine du 1er au 15 novembre',
    );
  });

  it('says before the first validation that it closes the period, then validates one by one, a refusal on its row', async () => {
    answer = (path) =>
      path.includes(statementOf(BASILE, OCT2).id)
        ? {
            status: 409,
            body: refusal('commission_statement_changed_conflict'),
          }
        : { status: 200, body: statementOf(THEO, OCT2, { status: 'validated' }) };
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider (4)' }));

    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Clore la quinzaine du 16 au 31 octobre ?');
    // Every statement at once: one amount to pay, the team's.
    expect(text(dialog.querySelector('.py-lines__pay'))).toBe('À verser342,50 €');
    expect(text(dialog)).not.toContain('pour l’équipe');
    expect(text(dialog)).toContain(
      'Un rapport validé après la clôture ira sur la quinzaine du 1er au 15 novembre',
    );
    expect(writes).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clore et valider 4 relevés' }));

    // Held like any validation, five seconds to take it back, then sent.
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(text(screen.getByRole('status'))).toContain('Validation de 4 relevés');
    expect(writes).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => {
      expect(writes).toHaveLength(4);
    });
    // In the members' order, each with the revision the reader saw.
    expect(writes.map(({ path }) => path)).toEqual(
      [BASILE, IRIS, LOU, THEO].map((one) => `/v1/payroll/statements/${statementOf(one, OCT2).id}/validate`),
    );
    expect(writes.every(({ body }) => JSON.stringify(body) === '{"revision":3}')).toBe(true);
    expect(text(await within(row('Basile')).findByRole('alert'))).toContain(
      'Ce relevé a changé depuis que tu l’as ouvert. Relis la nouvelle version avant de valider.',
    );
    expect(screen.getByRole('button', { name: 'Relire le relevé de Basile' })).toBeTruthy();
    // What passed and what did not, said as for any validation.
    const said = text(screen.getAllByRole('alert').find((one) => one.classList.contains('rp-island')));
    expect(said).toContain('3 validés, 1 non validé');
    expect(said).toContain('Basile : Ce relevé a changé depuis que tu l’as ouvert.');
  });

  it('says « Parti » beside a member who left the team, and of no one else (recette EQP-17)', async () => {
    team = MEMBERS.map((one): TeamMember => (one.id === LOU.id ? { ...one, status: 'left' } : one));
    renderPage(OWNER);
    await screen.findByRole('button', { name: 'Lou' });
    expect(await within(row('Lou')).findByText('Parti')).toBeTruthy();
    expect(within(row('Lou')).getByText('Parti').className).toBe('rp-chip rp-chip--neutral');
    expect(within(row('Théo')).queryByText('Parti')).toBeNull();
  });

  it('says what one statement pays apart from the whole team, when it alone closes the period (recette EQP-16)', async () => {
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Basile' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Valider ce relevé' }),
    );
    const dialog = await screen.findByRole('dialog', { name: /^Clore la quinzaine/u });
    expect(text(dialog)).toContain('Tu valides un relevé : il clôt la quinzaine pour toute l’équipe.');
    const lines = [...dialog.querySelectorAll('.py-lines > div')].map((one) => text(one));
    expect(lines.slice(-2)).toEqual([
      'À verser pour l’équipetous les relevés de la quinzaine342,50 €',
      'Ce relevéce que tu valides maintenant21,25 €',
    ]);
    expect(within(dialog).getByRole('button', { name: 'Clore et valider le relevé' })).toBeTruthy();
  });

  it('says what blocks the period, and offers nothing to validate meanwhile, the manager’s own row locked', async () => {
    periods[OCT2] = endedOctober({}, false);
    reports = [
      { ...report(1, BASILE.id), status: 'submitted' },
      { ...report(2, LOU.id), status: 'submitted' },
    ];
    renderPage(IRIS_ME);
    expect(await screen.findByText('2 rapports de la quinzaine attendent leur relecture')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Relire les 2 rapports' }).getAttribute('href')).toBe(
      '/equipe/rapports',
    );
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBeNull();
    expect(text(row('Iris'))).toContain('Ton relevé : un autre membre de l’agence le valide.');
  });

  it('says in amber that pay could not compute the period, who lacks a rate, and never shows its figures as true', async () => {
    const blocked = {
      code: 'commission_rate_missing_conflict',
      memberIds: [LOU.id],
      since: '2026-11-01T23:30:00.000Z',
    };
    periods[OCT2] = endedOctober({ blocked });
    renderPage(OWNER);
    const title = await screen.findByText('Le calcul est bloqué : Lou n’a pas de taux pour cette quinzaine.');
    const notice = title.closest('.rp-notice');
    expect(notice?.getAttribute('data-tone')).toBe('warn');
    expect(text(notice)).toContain(
      'Un rapport validé de Lou tombe sur une quinzaine où son taux n’a pas encore commencé.',
    );
    expect(text(notice)).toContain('elle se corrige dans la base, puis le calcul reprend seul.');
    expect(text(notice)).toContain('ils ne sont plus à jour');
    expect(text(notice)).toContain('Bloqué depuis le lundi 2 novembre à 0 h 30.');
    // No gesture of the screen lifts it: no button reads as one.
    expect(screen.queryByRole('link', { name: /^Ouvrir (sa fiche|les membres)$/u })).toBeNull();
    // The stale figures say so, and nothing validates on them.
    expect(screen.queryByText('À verser une fois validé')).toBeNull();
    expect(screen.getByText('À verser une fois validé, au dernier calcul réussi')).toBeTruthy();
    expect(screen.getByText('Plus à jour : le calcul est bloqué.')).toBeTruthy();
    expect(screen.getByText('Calcul bloqué').className).toContain('rp-chip--warn');
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBeNull();
    expect(screen.queryByText(/Le premier relevé validé clôt la quinzaine/u)).toBeNull();
  });

  it('tells a manager the owner is told, with no record to open', async () => {
    periods[OCT2] = endedOctober({
      blocked: {
        code: 'commission_rate_missing_conflict',
        memberIds: [LOU.id],
        since: '2026-11-01T23:30:00.000Z',
      },
    });
    renderPage(IRIS_ME);
    const title = await screen.findByText('Le calcul est bloqué : Lou n’a pas de taux pour cette quinzaine.');
    expect(text(title.closest('.rp-notice'))).toContain(
      'Le propriétaire est prévenu ; le calcul reprendra seul',
    );
    expect(screen.queryByRole('link', { name: 'Ouvrir sa fiche' })).toBeNull();
  });

  it('lets the owner mark a validated statement paid in two steps, the amount to pay and none other', async () => {
    const closed = {
      period: OCT2,
      exchangeRates: [],
      closedBy: OWNER_USER,
      closedAt: '2026-11-02T08:41:00.000Z',
    };
    periods[OCT2] = periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, {
          status: 'validated',
          payableMinor: 28_840,
          totalMinor: 28_840,
          canValidate: false,
        }),
      ],
      { closing: closed },
    );
    renderPage(OWNER);
    fireEvent.click(
      await within(await waitFor(() => row('Théo'))).findByRole('button', { name: 'Marquer payé' }),
    );
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Montant envoyé, en euros');
    fireEvent.change(amount, { target: { value: '200' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(within(dialog).getByText(/Celui à verser/u))).toContain('288,40 €');
    expect(within(dialog).queryByText(/versés à/u)).toBeNull();

    fireEvent.change(amount, { target: { value: '288,40' } });
    // Never before the period's first day, never an IBAN in the reference (an invented one, its check digits right).
    const day = within(dialog).getByLabelText('Payé le');
    fireEvent.change(day, { target: { value: '2026-10-15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).getByText('Un jour du vendredi 16 octobre à aujourd’hui.')).toBeTruthy();
    expect(within(dialog).queryByText(/versés à/u)).toBeNull();

    fireEvent.change(day, { target: { value: '2026-11-02' } });
    const reference = within(dialog).getByLabelText('Référence WorldRemit, facultative');
    fireEvent.change(reference, { target: { value: 'FR62 1234 5678 9000 00AB C123 456' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).getByText(/Ceci contient un IBAN/u)).toBeTruthy();
    expect(within(dialog).queryByText(/versés à/u)).toBeNull();

    fireEvent.change(reference, { target: { value: 'WR-4E7F2C1A' } });
    // WorldRemit pays the chatters, and nothing else: no method to choose.
    expect(within(dialog).queryByRole('radiogroup')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(await within(dialog).findByText(/versés à/u))).toBe(
      '288,40 € versés à Théo le lundi 2 novembre par WorldRemit, référence WR-4E7F2C1A, pour la quinzaine du 16 au 31 octobre.',
    );
    // What it is worth in CFA francs, a guide only: the euro stays what is sent.
    expect(text(within(dialog).getByText(/FCFA/u))).toBe(
      '≈ 189 178 FCFA, avant frais WorldRemit (1 € = 655,957 FCFA, parité fixe). Indicatif : le montant envoyé reste en euros.',
    );
    answer = () => ({ status: 200, body: statementOf(THEO, OCT2, { status: 'paid' }) });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marquer payé' }));
    await waitFor(() => {
      expect(writes).toEqual([
        {
          path: `/v1/payroll/statements/${statementOf(THEO, OCT2).id}/pay`,
          body: {
            revision: 3,
            paidOn: '2026-11-02',
            method: 'worldremit',
            sentMinor: 28_840,
            reference: 'WR-4E7F2C1A',
          },
        },
      ]);
    });
  });

  it.each([
    ['Lou', LOU, 'Madagascar'],
    ['Basile', BASILE, 'France'],
  ])('gives no amount in CFA francs to pay %s, who lives in %s', async (name, who) => {
    periods[OCT2] = periodOf(OCT2, [statementOf(who, OCT2, { status: 'validated', canValidate: false })], {
      closing: {
        period: OCT2,
        exchangeRates: [],
        closedBy: OWNER_USER,
        closedAt: '2026-11-02T08:41:00.000Z',
      },
    });
    renderPage(OWNER);
    fireEvent.click(
      await within(await waitFor(() => row(name))).findByRole('button', { name: 'Marquer payé' }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(await within(dialog).findByText(/versés à/u)).toBeTruthy();
    expect(within(dialog).queryByText(/FCFA/u)).toBeNull();
  });

  it('keeps « Marquer payé » busy until the period is read again, and reads a statement paid meanwhile without a word', async () => {
    const closed = {
      period: OCT2,
      exchangeRates: [],
      closedBy: OWNER_USER,
      closedAt: '2026-11-02T08:41:00.000Z',
    };
    const validated = statementOf(THEO, OCT2, { status: 'validated', canValidate: false });
    const paid = statementOf(THEO, OCT2, {
      ...PAID,
      payment: { ...PAID.payment, paidOn: '2026-11-02', sentMinor: validated.payableMinor },
    });
    const pay = async () => {
      fireEvent.click(
        await within(await waitFor(() => row('Théo'))).findByRole('button', { name: 'Marquer payé' }),
      );
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
      fireEvent.click(await within(dialog).findByRole('button', { name: 'Marquer payé' }));
      return dialog;
    };
    periods[OCT2] = periodOf(OCT2, [validated], { closing: closed });
    renderPage(OWNER);
    await waitFor(() => row('Théo'));
    // Paid, but the period is not read again yet: the button stays busy, and a second click sends nothing.
    let release = (): void => undefined;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    answer = () => ({ status: 200, body: paid });
    periods[OCT2] = periodOf(OCT2, [paid], { closing: closed });
    let dialog = await pay();
    const busy = await within(dialog).findByRole('button', { name: 'Enregistrement…' });
    expect(busy.hasAttribute('disabled')).toBe(true);
    fireEvent.click(busy);
    expect(writes).toHaveLength(1);
    gate = null;
    release();
    // Read again, paid, in the same dialog: the page stays on the period it opened, though none is left to pay there.
    expect(text(await within(dialog).findByText(/^Payé le/u))).toBe(
      'Payé le lundi 2 novembre par WorldRemit, marqué par Charles.',
    );
    expect(writes).toHaveLength(1);

    // Paid meanwhile from another tab: the refusal reads the period again and says nothing, the statement is paid.
    cleanup();
    writes.length = 0;
    periods[OCT2] = periodOf(OCT2, [validated], { closing: closed });
    renderPage(OWNER);
    await waitFor(() => row('Théo'));
    periods[OCT2] = periodOf(OCT2, [paid], { closing: closed });
    answer = () => ({ status: 409, body: refusal('commission_statement_status_conflict') });
    dialog = await pay();
    expect(text(await within(dialog).findByText(/^Payé le/u))).toBe(
      'Payé le lundi 2 novembre par WorldRemit, marqué par Charles.',
    );
    expect(within(dialog).queryByRole('alert')).toBeNull();

    // The server gone with it: the refusal is said as it is, never « pas encore validé ».
    cleanup();
    periods[OCT2] = periodOf(OCT2, [validated], { closing: closed });
    renderPage(OWNER);
    await waitFor(() => row('Théo'));
    periods[OCT2] = 'down';
    dialog = await pay();
    expect(text(await within(dialog).findByRole('alert'))).toBe(
      'Ce relevé n’est plus à payer : il a déjà été marqué payé.',
    );
  });

  it('says in a statement’s foot where it stands: a draft follows the reports, a paid one how it was paid', async () => {
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Basile' }));
    let dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText('À valider : il suit chaque rapport validé jusqu’à sa validation.'),
    ).toBeTruthy();
    // The engine's revision stays in « Règles et calcul »: the gesture validates this statement, as shown.
    expect(within(dialog).getByRole('button', { name: 'Valider ce relevé' })).toBeTruthy();
    expect(text(within(dialog).getByRole('heading').parentElement)).not.toMatch(/révision/u);
    expect(text(within(dialog).getByText('Règles et calcul').nextElementSibling)).toMatch(
      /^révision 3 · calculé /u,
    );
    // The change against the period before is said in French, with what it compares to (recette EQP-13):
    // Basile had no statement then, which « nouveau » says.
    expect(text(within(dialog).getByText(/^net /u))).toBe(
      'net 85,00 € nouveau : rien sur la quinzaine du 1er au 15 octobre',
    );
    fireEvent.click(within(dialog).getByText('Fermer', { selector: '.py-dialog__foot button' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Théo' }));
    dialog = await screen.findByRole('dialog');
    expect(text(within(dialog).getByText(/^net /u))).toMatch(
      /^net .+ € [+−]\d+ % par rapport à la quinzaine du 1er au 15 octobre$/u,
    );
    fireEvent.click(within(dialog).getByText('Fermer', { selector: '.py-dialog__foot button' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    periods[OCT1] = periodOf(
      OCT1,
      [statementOf(THEO, OCT1, { ...PAID, payment: { ...PAID.payment, reference: 'WR-1' } })],
      {
        closing: {
          period: OCT1,
          exchangeRates: [],
          closedBy: OWNER_USER,
          closedAt: '2026-10-16T08:00:00.000Z',
        },
      },
    );
    cleanup();
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT1}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Théo' }));
    dialog = await screen.findByRole('dialog');
    expect(text(within(dialog).getByText(/^Payé le/u))).toBe(
      'Payé le samedi 17 octobre par WorldRemit, référence WR-1, marqué par Charles.',
    );
  });

  it('opens a member’s statement from his record in Équipe, or says he has none on the period (EQ-11)', async () => {
    renderPage(OWNER, `/paie/quinzaine?membre=${BASILE.id}`);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading').textContent).toContain('Basile');
    cleanup();
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT1}&membre=${BASILE.id}`);
    expect(text(await screen.findByText(/^Pas de relevé de/u))).toBe(
      'Pas de relevé de Basile sur cette quinzaine.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('adjusts a validated statement on the member’s next period to validate, which it says before sending', async () => {
    const validated = statementOf(THEO, OCT2, { status: 'validated', canValidate: false });
    periods[OCT2] = periodOf(OCT2, [validated], {
      closing: {
        period: OCT2,
        exchangeRates: [],
        closedBy: OWNER_USER,
        closedAt: '2026-11-02T08:41:00.000Z',
      },
    });
    answer = () => ({
      status: 201,
      body: adjustmentOf(9, THEO, NOV1, { amountMinor: 500, correctsStatementId: validated.id }),
    });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Théo' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajuster' }));
    expect(text(await within(dialog).findByText(/^Il va sur la quinzaine/u))).toBe(
      'Il va sur la quinzaine du 1er au 15 novembre : la prochaine de Théo à valider.',
    );
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: '5' } });
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Rapport du 28 oct. oublié.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(await within(dialog).findByText(/^Il corrige/u))).toBe(
      'Il corrige son relevé du 16 au 31 octobre, qui ne change plus. Un ajustement ne s’annule pas : une erreur se corrige par un autre. Théo le lira avec son relevé.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter l’ajustement' }));
    expect(text(await within(dialog).findByRole('status'))).toBe(
      'Ajustement de +5,00 € pour Théo ajouté sur la quinzaine du 1er au 15 novembre.',
    );
    expect(writes).toEqual([
      {
        path: '/v1/payroll/adjustments',
        body: {
          id: AN_ID,
          memberId: THEO.id,
          amountMinor: 500,
          reason: 'Rapport du 28 oct. oublié.',
          correctsStatementId: validated.id,
        },
      },
    ]);
  });

  it('says to a withdrawal on a member who left that it never brings his total below zero, and never that he will read it (ADR 0072 § 5)', async () => {
    team = MEMBERS.map((one): TeamMember => (one.id === LOU.id ? { ...one, status: 'left' } : one));
    const validated = statementOf(LOU, OCT2, { status: 'validated', canValidate: false });
    periods[OCT2] = periodOf(OCT2, [validated], {
      closing: {
        period: OCT2,
        exchangeRates: [],
        closedBy: OWNER_USER,
        closedAt: '2026-11-02T08:41:00.000Z',
      },
    });
    answer = () => ({
      status: 409,
      body: {
        error: {
          code: 'pay_adjustment_below_zero_conflict',
          message: 'x',
          details: { totalMinor: -1_250, memberId: LOU.id },
          requestId: 'req-1',
        },
      },
    });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Lou' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajuster' }));
    fireEvent.click(await within(dialog).findByRole('radio', { name: 'Retirer' }));
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: '20' } });
    expect(text(within(dialog).getByText(/^Retiré de son total/u))).toBe(
      'Retiré de son total, −20,00 €. Lou a quitté l’équipe : un retrait qui mettrait son total sous zéro est refusé.',
    );
    expect(
      within(dialog).getByText('Gardé sur son relevé. Jamais le message ni le nom d’un fan.'),
    ).toBeTruthy();
    expect(within(dialog).queryByText(/Lu par le membre/u)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Pack remboursé après son départ.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    const summary = text(await within(dialog).findByText(/^Il corrige/u));
    expect(summary).toContain('Le motif reste sur son relevé.');
    expect(summary).not.toContain('le lira');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter l’ajustement' }));
    expect(text(await within(dialog).findByRole('alert'))).toBe(
      'Ce retrait ferait passer le total de Lou, qui a quitté l’équipe, à −12,50 € : un membre parti ne finit jamais sous zéro, rien n’a été enregistré.',
    );
  });

  it('says a transfer that waits for a tax residence certificate apart, and offers no « Marquer payé » for it (ADR 0041)', async () => {
    const validatedAt = '2026-11-02T08:41:00.000Z';
    periods[OCT2] = periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, {
          status: 'validated',
          payableMinor: 10_000,
          totalMinor: 10_000,
          validatedAt,
          payoutBlock: { reason: 'tax_residence_missing', year: '2026' },
        }),
        statementOf(BASILE, OCT2, {
          status: 'validated',
          payableMinor: 20_000,
          totalMinor: 20_000,
          validatedAt,
        }),
      ],
      { closing: { period: OCT2, exchangeRates: [], closedBy: OWNER_USER, closedAt: validatedAt } },
    );
    renderPage(OWNER);
    expect(text((await screen.findByText('Reste à envoyer')).nextElementSibling)).toBe('300,00 €');
    expect(text(screen.getByText(/^Dont/u))).toBe('Dont 100,00 € au versement bloqué (1 relevé)');
    expect(text(row('Théo'))).toContain('Versement bloqué : attestation de résidence 2026 absente.');
    expect(within(row('Théo')).getByText('Versement bloqué').className).toContain('rp-chip--warn');
    expect(within(row('Théo')).queryByRole('button', { name: 'Marquer payé' })).toBeNull();
    expect(within(row('Basile')).getByRole('button', { name: 'Marquer payé' })).toBeTruthy();
    // Its statement says why in its foot, with nothing to mark paid.
    fireEvent.click(within(row('Théo')).getByRole('button', { name: 'Théo' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Versement bloqué : attestation de résidence 2026 absente.');
    expect(within(dialog).queryByRole('button', { name: 'Marquer payé' })).toBeNull();
  });

  it('names what holds an invoice back, and leads the owner to where it is settled (recette EQP-04)', async () => {
    const validatedAt = '2026-11-02T08:41:00.000Z';
    const held = (reason: 'no_mandate' | 'agency_missing') => ({
      status: 'validated' as const,
      payableMinor: 10_000,
      totalMinor: 10_000,
      validatedAt,
      payoutBlock: { reason: 'documents_not_issued' as const, year: null },
      notIssuedReason: reason,
    });
    periods[OCT2] = periodOf(
      OCT2,
      [statementOf(THEO, OCT2, held('no_mandate')), statementOf(BASILE, OCT2, held('agency_missing'))],
      { closing: { period: OCT2, exchangeRates: [], closedBy: OWNER_USER, closedAt: validatedAt } },
    );
    renderPage(OWNER);
    await waitFor(() => row('Théo'));
    expect(text(row('Théo'))).toContain(
      'Versement bloqué : facture pas encore émise, le membre n’a pas encore accepté son mandat de facturation.',
    );
    expect(within(row('Théo')).getByRole('link', { name: 'Ouvrir son dossier' }).getAttribute('href')).toBe(
      `/equipe/membres/${THEO.id}/dossier`,
    );
    // What is the agency's is settled in Réglages › Facturation.
    expect(
      within(row('Basile')).getByRole('link', { name: 'Ouvrir Réglages › Facturation' }).getAttribute('href'),
    ).toBe('/reglages/facturation');
    // The statement says it in its foot, with the same way to settle it.
    fireEvent.click(within(row('Théo')).getByRole('button', { name: 'Théo' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('le membre n’a pas encore accepté son mandat de facturation.');
    expect(within(dialog).getByRole('link', { name: 'Ouvrir son dossier' })).toBeTruthy();
  });

  it('says the server does not answer when the agency’s settings cannot be read, and reads them again (recette EQP-05)', async () => {
    settingsDown = true;
    renderPage(OWNER);
    const said = await screen.findByText(
      'Le serveur ne répond pas : la quinzaine en cours n’a pas pu être lue.',
    );
    settingsDown = false;
    fireEvent.click(
      within(said.closest('.sc-empty') ?? document.body).getByRole('button', { name: 'Réessayer' }),
    );
    await waitFor(() => row('Théo'));
    expect(screen.queryByText(/Le serveur ne répond pas/u)).toBeNull();
  });

  it('tells a manager why a transfer waits, the way to settle it being the owner’s (recette EQP-04)', async () => {
    periods[OCT2] = periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, {
          status: 'validated',
          canValidate: false,
          payableMinor: 10_000,
          totalMinor: 10_000,
          validatedAt: '2026-11-02T08:41:00.000Z',
          payoutBlock: { reason: 'documents_not_issued', year: null },
          notIssuedReason: 'identity_unverified',
        }),
      ],
      {
        closing: {
          period: OCT2,
          exchangeRates: null,
          closedBy: OWNER_USER,
          closedAt: '2026-11-02T08:41:00.000Z',
        },
      },
    );
    renderPage(IRIS_ME, `/paie/quinzaine?quinzaine=${OCT2}`);
    await waitFor(() => row('Théo'));
    expect(text(row('Théo'))).toContain(
      'Versement bloqué : facture pas encore émise, son identité attend la vérification du propriétaire dans son dossier.',
    );
    expect(within(row('Théo')).queryByRole('link')).toBeNull();
  });

  it('never offers a manager to mark a statement paid', async () => {
    periods[OCT2] = periodOf(OCT2, [statementOf(THEO, OCT2, { status: 'validated', canValidate: false })], {
      closing: {
        period: OCT2,
        exchangeRates: null,
        closedBy: OWNER_USER,
        closedAt: '2026-11-02T08:41:00.000Z',
      },
    });
    renderPage(IRIS_ME, `/paie/quinzaine?quinzaine=${OCT2}`);
    await waitFor(() => row('Théo'));
    expect(screen.queryByRole('button', { name: 'Marquer payé' })).toBeNull();
    expect(text(screen.getByText(/^Close le/u))).toBe(
      'Close le lundi 2 novembre à 9 h 41 par le propriétaire',
    );
  });

  it('holds a validation five seconds once the period is closed, and reads a statement validated meanwhile again without a word', async () => {
    periods[OCT2] = periodOf(OCT2, [statementOf(BASILE, OCT2)], {
      closing: {
        period: OCT2,
        exchangeRates: [],
        closedBy: OWNER_USER,
        closedAt: '2026-11-02T08:41:00.000Z',
      },
    });
    answer = () => ({ status: 409, body: refusal('commission_statement_status_conflict') });
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider (1)' }));
    expect(text(await screen.findByRole('status'))).toContain('Validation du relevé de Basile');
    expect(writes).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(within(row('Basile')).queryByRole('alert')).toBeNull();
  });

  it('keeps saying a stop after a validation that passed: the server down after Basile, the others wait', async () => {
    const closing = {
      period: OCT2,
      exchangeRates: [],
      closedBy: OWNER_USER,
      closedAt: '2026-11-02T08:41:00.000Z',
    };
    periods[OCT2] = endedOctober({ closing });
    answer = (path) => {
      if (!path.includes(statementOf(BASILE, OCT2).id)) return { status: 503, body: null };
      const validated = statementOf(BASILE, OCT2, { status: 'validated', canValidate: false });
      const october = periods[OCT2];
      if (october !== undefined && october !== 'down')
        periods[OCT2] = {
          ...october,
          statements: october.statements.map((one) => (one.id === validated.id ? validated : one)),
        };
      return { status: 200, body: validated };
    };
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider (4)' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await waitFor(() => {
      expect(text(screen.getAllByRole('alert').find((one) => one.classList.contains('rp-island')))).toContain(
        '1 validé, 3 non validés',
      );
    });
    // The period read again shows Basile validated, and the stop still holds: nothing more is offered to validate.
    expect(within(row('Basile')).getByText('Validé')).toBeTruthy();
    const stop = screen.getAllByRole('alert').find((one) => one.classList.contains('rp-notice'));
    expect(text(stop)).toContain('Le serveur ne répond pas : rien n’a été enregistré.');
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBeNull();
  });

  it('exports the period, its file kept a minute for the browser to save it', async () => {
    const files: Blob[] = [];
    const revoked: string[] = [];
    const saved = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.stubGlobal(
      'URL',
      class extends URL {
        static override createObjectURL(file: Blob): string {
          files.push(file);
          return 'blob:releves';
        }
        static override revokeObjectURL(url: string): void {
          revoked.push(url);
        }
      },
    );
    try {
      renderPage(OWNER);
      fireEvent.click(await screen.findByRole('button', { name: 'Exporter (CSV)' }));
      expect(saved).toHaveBeenCalledTimes(1);
      // UTF-8 with its mark, for the spreadsheet: « Théo » stays « Théo ».
      const bytes = new Uint8Array((await files[0]?.arrayBuffer()) ?? new ArrayBuffer(0));
      expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(bytes).startsWith('Membre;Compte;Devise')).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_000);
      });
      expect(revoked).toEqual([]);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(revoked).toEqual(['blob:releves']);
    } finally {
      saved.mockRestore();
    }
  });

  it('splits the sales in the design system’s bar, each creator in a colour of her own, in the bar and its legend', async () => {
    const accounts = ['Mia', 'Zoé', 'Ana'].map((creatorName, index) => ({
      id: payId(21 + index),
      creatorId: payId(31 + index),
      creatorName,
      platform: 'reveal',
      handle: creatorName.toLowerCase(),
      archived: false,
    }));
    rules = {
      ...PAY_RULES,
      accounts: [...PAY_RULES.accounts, ...accounts.map((account) => ({ account, rules: [] }))],
    };
    const lines = [NORA_REVEAL.id, LEA_ONLYFANS.id, ...accounts.map((account) => account.id)].map(
      (id, index) => euroLine({ platformAccountId: id, netMinor: (5 - index) * 1_000 }),
    );
    periods[OCT2] = periodOf(OCT2, [statementOf(THEO, OCT2, { lines })]);
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    const fold = (await screen.findByText('Par créatrice')).parentElement;
    const parts = [...(fold?.querySelectorAll('.nv-split__part') ?? [])];
    const keys = [...(fold?.querySelectorAll('.nv-legend__key') ?? [])];
    const colour = (element: Element) =>
      element instanceof HTMLElement ? element.style.getPropertyValue('--_c') : '';
    // Five creators, four parts: the two smallest in « Autres ».
    expect([...(fold?.querySelectorAll('.nv-legend__item') ?? [])].map((item) => text(item))).toEqual([
      'Nora Vidal 33 %',
      'Léa 27 %',
      'Mia 20 %',
      'Autres 20 %',
    ]);
    expect(new Set(parts.map(colour)).size).toBe(4);
    expect(keys.map(colour)).toEqual(parts.map(colour));
    expect(
      parts.map((part) => (part instanceof HTMLElement ? part.style.getPropertyValue('--nv-w') : '')),
    ).toEqual(['33.33%', '26.67%', '20%', '20%']);
  });

  it('says the server does not answer, never an empty period', async () => {
    periods[OCT2] = 'down';
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    expect(
      await screen.findByText('Le serveur ne répond pas : la quinzaine n’a pas pu être lue.'),
    ).toBeTruthy();
  });

  it('says a period before the team’s first closing is closed without a statement, never paid', async () => {
    // Pay never wrote it: no window, so the server never says it has ended either.
    periods[OCT1] = periodOf(OCT1, [], { window: null, ended: false, beforeFirstClosing: true });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT1}`);
    expect(await screen.findByText('Close avant la première clôture')).toBeTruthy();
    expect(
      screen.getByText('Avant la première clôture de l’équipe : la quinzaine est close sans relevé.'),
    ).toBeTruthy();
    expect(screen.getByText('Aucun relevé avant la première clôture.')).toBeTruthy();
    expect(screen.queryByText('Payée')).toBeNull();
    // No sum, ended or running: there is nothing to sum, ever.
    expect(screen.queryByText(/pour la quinzaine|Net de l’équipe/u)).toBeNull();
    expect(screen.queryByText('À ce jour, membre par membre')).toBeNull();
  });

  it('shows a running period’s net and where its pace leads, with nothing to validate', async () => {
    // Thursday 5 November at midnight in Paris: five days of fifteen gone.
    vi.setSystemTime(new Date('2026-11-05T23:00:00Z'));
    // The server's forecast: 500 € in five days, three times as much at the end.
    periods[NOV1] = periodOf(NOV1, [statementOf(THEO, NOV1, { netMinor: 50_000 })], {
      pace: { lateNetMinor: 0, forecastNetMinor: 150_000, goal: null },
    });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${NOV1}`);
    expect(await screen.findByText('Net de l’équipe à ce jour')).toBeTruthy();
    // The forecast is a figure of its own, in whole euros, said once.
    expect(text(screen.getByText('Prévision de fin').nextElementSibling)).toBe('1 500 €');
    expect(screen.queryByText(/À ce rythme/u)).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBeNull();
  });

  it('reads the share of the goal and where it heads from the server, never from the net', async () => {
    vi.setSystemTime(new Date('2026-11-05T23:00:00Z'));
    // The server's shares on a 1 500 € goal: 33 % reached, 100 % forecast; the screen recomputes neither.
    periods[NOV1] = periodOf(NOV1, [statementOf(THEO, NOV1, { netMinor: 50_000 })], {
      collectiveGoal: goalOf(NOV1),
      pace: {
        lateNetMinor: 0,
        forecastNetMinor: 150_000,
        goal: { reachedBps: 3_333, forecastReachedBps: 10_000 },
      },
    });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${NOV1}`);
    const goal = (await screen.findByText('Objectif collectif')).closest('.py-fig');
    expect(text(goal?.querySelector('.py-fig__value'))).toBe('33 %');
    expect(text(goal?.querySelector('.py-fig__note'))).toBe(
      'prévu 100 % : palier 100 %, +25,00 € par chatteur',
    );
  });
});

describe('Paie › Quinzaine › Ventes en attente (CRM-03 lot b4b)', () => {
  const panel = async (): Promise<HTMLElement> => {
    const found = (await screen.findByText('Ventes en attente')).closest('section');
    if (found === null) throw new Error('No panel of held sales');
    return found;
  };
  const card = (inside: HTMLElement, what: RegExp): HTMLElement => {
    const found = within(inside).getByText(what).closest('li');
    if (found === null) throw new Error(`No card for ${String(what)}`);
    return found;
  };

  it('shows nothing while the period holds no sale', async () => {
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    await screen.findByRole('button', { name: 'Théo' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.queryByText('Ventes en attente')).toBeNull();
  });

  it('lists what waits and what was decided, why, and the gestures each one offers', async () => {
    held[OCT2] = [
      heldSaleOf(),
      heldSaleOf({
        platformSaleId: 'vente-2',
        memberId: null,
        reason: 'chatter_unlinked',
        outcomes: ['exclude'],
        netMinor: 2_500,
      }),
      heldSaleOf({ platformSaleId: 'vente-3', reason: null, decision: 'exclude', outcomes: ['withdraw'] }),
    ];
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    const list = await panel();
    expect(text(list)).toContain('2 attendent une décision · 1 décidée');
    expect(text(list)).toContain('Elles n’empêchent pas la clôture');

    const offShift = card(list, /^Théo n’était ni en poste/u);
    expect(text(offShift)).toContain('Nora Vidal · @nora sur Reveal');
    expect(text(offShift)).toContain('Vente du mercredi 28 octobre à 22 h · chatteur Théo');
    expect(text(offShift)).toContain('+42,00 €');
    expect(within(offShift).getByText('En attente').className).toContain('rp-chip--warn');
    expect(within(offShift).getByRole('button', { name: 'Compter pour Théo' })).toBeTruthy();
    expect(within(offShift).getByRole('button', { name: 'Écarter' })).toBeTruthy();

    const unlinked = card(list, /^Son chatteur sur Reveal n’est relié à aucun membre/u);
    expect(text(unlinked)).toContain('chatteur non relié');
    expect(within(unlinked).queryByRole('button', { name: /^Compter/u })).toBeNull();

    const excluded = card(list, /^Écartée$/u);
    expect(within(excluded).getByRole('button', { name: 'Retirer la décision' })).toBeTruthy();
  });

  it('counts a sale for its member after reading it again, with a note, then reads the list again', async () => {
    held[OCT2] = [heldSaleOf()];
    answer = () => ({
      status: 201,
      body: {
        id: payId(900),
        platform: 'reveal',
        platformSaleId: 'vente-1',
        revision: 1,
        platformAccountId: payId(11),
        outcome: 'count',
        reason: 'off_shift',
        memberId: THEO.id,
        note: 'Shift prolongé d’une heure.',
        decidedBy: OWNER_USER,
        createdAt: '2026-11-02T09:00:00.000Z',
      },
    });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    fireEvent.click(within(await panel()).getByRole('button', { name: 'Compter pour Théo' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain('Compter cette vente pour Théo ?');
    expect(text(dialog)).toContain('Elle va sur son relevé, ses remboursements avec elle.');
    expect(writes).toEqual([]);

    fireEvent.change(within(dialog).getByLabelText('Note (facultatif)'), {
      target: { value: '  Shift prolongé d’une heure.  ' },
    });
    held[OCT2] = [heldSaleOf({ decision: 'count', outcomes: ['exclude', 'withdraw'] })];
    fireEvent.click(within(dialog).getByRole('button', { name: 'Compter pour Théo' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toEqual([
      {
        path: '/v1/payroll/sale-decisions',
        body: {
          id: AN_ID,
          period: OCT2,
          platform: 'reveal',
          platformSaleId: 'vente-1',
          outcome: 'count',
          note: 'Shift prolongé d’une heure.',
        },
      },
    ]);
    expect(await within(await panel()).findByText('Comptée pour Théo')).toBeTruthy();
  });

  it('says a refusal in the dialog, keeps the same id to send again, and reads the list again when it moved', async () => {
    held[OCT2] = [heldSaleOf()];
    answer = () => ({ status: 404, body: refusal('pay_sale_not_found') });
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    fireEvent.click(within(await panel()).getByRole('button', { name: 'Écarter' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Écarter' }));
    expect(text(await within(dialog).findByRole('alert'))).toBe(
      'Cette vente n’attend plus de décision dans cette quinzaine : la liste est relue.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Écarter' }));
    await waitFor(() => {
      expect(writes).toHaveLength(2);
    });
    const [first, second] = writes.map((one) => JSON.stringify(one.body));
    expect(second).toBe(first);
    expect(writes[0]?.body).toMatchObject({ outcome: 'exclude', note: null });
  });

  it('says a list it could not read, never an empty one, and reads it again on « Réessayer »', async () => {
    held[OCT2] = 'down';
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    const list = await panel();
    expect(
      await within(list).findByText(
        'Le serveur ne répond pas : la liste des ventes en attente n’a pas pu être lue.',
      ),
    ).toBeTruthy();
    held[OCT2] = [heldSaleOf()];
    fireEvent.click(within(list).getByRole('button', { name: 'Réessayer' }));
    expect(await within(await panel()).findByText('1 attend une décision')).toBeTruthy();
  });

  it('never asks for the list for a member the server would refuse, a manager on leave', async () => {
    held[OCT2] = [heldSaleOf()];
    renderPage(
      { ...IRIS_ME, team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' },
      `/paie/quinzaine?quinzaine=${OCT2}`,
    );
    await screen.findByRole('button', { name: 'Théo' });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const asked = vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
    expect(asked.some((one) => one.endsWith('/held-sales'))).toBe(false);
    expect(screen.queryByText('Ventes en attente')).toBeNull();
  });

  it('names its sale to each gesture, for a screen reader out of the list', async () => {
    held[OCT2] = [heldSaleOf()];
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    const count = within(await panel()).getByRole('button', { name: 'Compter pour Théo' });
    const described = (count.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => text(document.getElementById(id)));
    expect(described).toEqual([
      'Nora Vidal · @nora sur Reveal',
      'Vente du mercredi 28 octobre à 22 h · chatteur Théo',
      '+42,00 €',
    ]);
  });

  it('shows a paid line its chatter signalled, with their note, and only « Écarter » (CRM-03 lot b4c)', async () => {
    held[OCT2] = [
      heldSaleOf({
        reason: null,
        outcomes: ['exclude'],
        signal: {
          memberId: THEO.id,
          note: 'Vendue pendant le shift de Lou',
          signalledAt: '2026-10-29T08:00:00.000Z',
        },
      }),
    ];
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${OCT2}`);
    const list = await panel();
    expect(text(list)).toContain(
      'Une vente signalée par son chatteur compte pour lui tant qu’elle n’est pas écartée.',
    );
    const signalled = card(list, /^Signalée par Théo/u);
    expect(text(signalled)).toContain(
      'Signalée par Théo : ce n’est pas sa vente. « Vendue pendant le shift de Lou »',
    );
    expect(within(signalled).getByText('Signalée').className).toContain('rp-chip--warn');
    expect(within(signalled).getAllByRole('button').map(text)).toEqual(['Écarter']);
  });

  it('leaves a sale of the reader’s own chatter to another member', async () => {
    held[OCT2] = [heldSaleOf({ memberId: IRIS.id })];
    renderPage(IRIS_ME, `/paie/quinzaine?quinzaine=${OCT2}`);
    const list = await panel();
    expect(text(list)).toContain('C’est une vente de ton chatteur : un autre membre en décide.');
    expect(within(list).queryByRole('button', { name: /^Compter|^Écarter/u })).toBeNull();
  });

  it('says a refund line in its own words: its chip, its gesture and the reader’s own chatter', async () => {
    const refund = {
      event: 'refund' as const,
      occurredAt: '2026-10-30T09:15:00.000Z',
      netMinor: -4_200,
    };
    held[OCT2] = [
      heldSaleOf({ ...refund, reason: null, decision: 'exclude', outcomes: ['withdraw'] }),
      heldSaleOf({ ...refund, platformSaleId: 'vente-2', memberId: IRIS.id }),
    ];
    renderPage(IRIS_ME, `/paie/quinzaine?quinzaine=${OCT2}`);
    const list = await panel();
    expect(text(list)).toContain('C’est un remboursement de ton chatteur : un autre membre en décide.');
    const excluded = card(list, /^Écarté$/u);
    fireEvent.click(within(excluded).getByRole('button', { name: 'Retirer la décision' }));
    const dialog = await screen.findByRole('dialog');
    expect(text(dialog)).toContain(
      'Le remboursement suit de nouveau les règles : il se déduit des ventes de Théo.',
    );
  });
});

function report(n: number, memberId: string) {
  return {
    id: payId(500 + n),
    shiftId: payId(600 + n),
    creatorId: payId(2),
    platformAccountId: payId(11),
    memberId,
    period: OCT2,
    correctsId: null,
    amount: { amountMinor: 10_000, currency: 'EUR' },
    comment: null,
    incident: null,
    version: 1,
    byAgency: false,
    canReview: true,
    submittedAt: '2026-10-31T22:00:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-10-31T22:00:00.000Z',
  };
}
