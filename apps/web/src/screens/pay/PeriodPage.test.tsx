// @vitest-environment jsdom
import type { Me, PayrollPeriod } from '@nirvana/contracts';
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
let rules: unknown;
/** The latest dollar rate the daily job read. */
let usd: unknown;
/** What a `POST` answers, from its path. */
let answer: (path: string) => { status: number; body: unknown };
const writes: { path: string; body: unknown }[] = [];
/** When set, a period is answered only once it resolves: a read the screen waits on. */
let gate: Promise<void> | null;

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
          return json({ members: MEMBERS });
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
  reports = [];
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
    expect(day.getAttribute('min')).toBe(OCT2);
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
    // The change against the period before is said with what it compares to.
    expect(text(dialog)).toContain('vs 1er – 15 octobre');
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
    periods[NOV1] = periodOf(NOV1, [statementOf(THEO, NOV1, { netMinor: 50_000 })]);
    renderPage(OWNER, `/paie/quinzaine?quinzaine=${NOV1}`);
    expect(await screen.findByText('Net de l’équipe à ce jour')).toBeTruthy();
    // The forecast is a figure of its own, in whole euros, said once.
    expect(text(screen.getByText('Prévision de fin').nextElementSibling)).toBe('1 500 €');
    expect(screen.queryByText(/À ce rythme/u)).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBeNull();
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
