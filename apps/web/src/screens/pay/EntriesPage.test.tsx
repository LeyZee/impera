// @vitest-environment jsdom
import type { Me, PayrollEntries, PayrollPeriod } from '@nirvana/contracts';
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

import { EntriesPage } from './EntriesPage';

import { parsePaySearch } from '@/payroll/model';
import {
  adjustmentOf,
  BASILE,
  bonusOf,
  entriesOf,
  IRIS,
  IRIS_ME,
  LOU,
  MEMBERS,
  NOV1,
  OCT2,
  OWNER,
  OWNER_USER,
  PAY_RULES,
  penaltyOf,
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
const text = (element: Element | null | undefined): string => (element?.textContent ?? '').replace(NBSP, ' ');
const refusal = (code: string, details: Record<string, unknown> = {}) => ({
  error: { code, message: code, details, requestId: 'req-1' },
});

let periods: Record<string, PayrollPeriod>;
let entries: Record<string, PayrollEntries | 'down'>;
let answer: (path: string) => { status: number; body: unknown };
const writes: { path: string; body: unknown }[] = [];
/** When set, the entries are answered only once it resolves: a read the screen waits on. */
let gate: Promise<void> | null = null;

const CLOSED = {
  period: OCT2,
  exchangeRates: [],
  closedBy: OWNER_USER,
  closedAt: '2026-11-02T08:41:00.000Z',
};

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
        case '/v1/payroll/entries': {
          const reply = () => {
            const asked = url.searchParams.get('period') ?? '';
            const found = entries[asked] ?? entriesOf(asked);
            return found === 'down' ? json(refusal('internal'), 500) : json(found);
          };
          return gate === null ? reply() : gate.then(reply);
        }
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

function renderPage(user: Me, initial = '/paie/primes-malus'): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/primes-malus',
    validateSearch: parsePaySearch,
    component: function Page() {
      const { quinzaine } = page.useSearch();
      const navigate = page.useNavigate();
      return (
        <EntriesPage
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

/** The entries of the period, in their list's order: the member's name and what follows. */
const rows = (): string[] => [...document.querySelectorAll('.py-entry')].map((one) => text(one));
const entry = (name: string, kind: string): HTMLElement => {
  const found = [...document.querySelectorAll<HTMLElement>('.py-entry')].find((one) =>
    text(one.querySelector('.py-entry__who')).startsWith(`${name}${kind}`),
  );
  if (found === undefined) throw new Error(`No entry for ${name}`);
  return found;
};

/** An entry's id, made by the screen: a fresh one, kept when the same entry is sent again. */
const AN_ID: unknown = expect.any(String);

const THEO_BONUS = bonusOf(1, THEO, NOV1, { reason: 'A formé Lou aux relances, deux soirs.' });

beforeEach(() => {
  gate = null;
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
  // Thursday 12 November, 14:00 in Paris: the first half of November runs, October's second half is closed.
  vi.setSystemTime(new Date('2026-11-12T13:00:00Z'));
  writes.length = 0;
  periods = {
    [OCT2]: periodOf(
      OCT2,
      [
        statementOf(THEO, OCT2, { status: 'validated', canValidate: false }),
        statementOf(IRIS, OCT2, { status: 'validated', canValidate: false }),
      ],
      { closing: CLOSED },
    ),
    [NOV1]: periodOf(
      NOV1,
      [THEO, BASILE, LOU, IRIS].map((one) => statementOf(one, NOV1)),
    ),
  };
  entries = {
    [NOV1]: entriesOf(NOV1, {
      bonuses: [THEO_BONUS],
      penalties: [
        penaltyOf(1, BASILE, NOV1, {
          reason: 'Shift du 4 nov. commencé avec 40 minutes de retard.',
          createdBy: IRIS.userId,
        }),
        penaltyOf(2, LOU, NOV1, {
          amount: { kind: 'percent', bps: 1_000 },
          reason: 'Relances envoyées hors des heures prévues.',
          cancellation: {
            cancelledAt: '2026-11-06T10:00:00.000Z',
            cancelledBy: OWNER_USER,
            cancelledFrom: NOV1,
          },
        }),
      ],
      adjustments: [adjustmentOf(1, IRIS, NOV1, { correctsStatementId: statementOf(IRIS, OCT2).id })],
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

describe('Paie › Primes et malus', () => {
  it('lists the period’s entries member by member, each signed, with its reason and author; a cancelled one struck through', async () => {
    renderPage(OWNER);
    await screen.findByText('« A formé Lou aux relances, deux soirs. »');
    expect(rows()).toEqual([
      'BasileMalus« Shift du 4 nov. commencé avec 40 minutes de retard. »par Iris le jeu. 5 nov.−15,00 €Annuler',
      'IrisAjustement« Rapport du 28 oct. compté deux fois. » · corrige son relevé du 16 au 31 octobrepar Charles le mar. 3 nov.−12,40 €',
      'LouMalus en pourcentageAnnulé« Relances envoyées hors des heures prévues. »annulé par Charles le ven. 6 nov.−10 %',
      'ThéoPrime« A formé Lou aux relances, deux soirs. »par Charles le lun. 9 nov.+30,00 €Annuler',
    ]);
    expect(entry('Lou', 'Malus').dataset['cancelled']).toBe('true');
    expect(screen.getAllByRole('button', { name: /^Ajouter$/u })).toHaveLength(1);
  });

  it('says what a penalty really takes, read in the statement: a percent in euros, a capped one what is kept', async () => {
    const capped = penaltyOf(1, BASILE, NOV1, { amount: { kind: 'fixed', amountMinor: 6_000 } });
    const percent = penaltyOf(3, THEO, NOV1, { amount: { kind: 'percent', bps: 1_000 } });
    entries = { [NOV1]: entriesOf(NOV1, { penalties: [capped, percent] }) };
    periods[NOV1] = periodOf(NOV1, [
      statementOf(BASILE, NOV1, {
        penalties: [capped],
        penaltiesRequestedMinor: 6_000,
        penaltiesMinor: 2_334,
      }),
      statementOf(THEO, NOV1, {
        penalties: [percent],
        penaltiesRequestedMinor: 10_000,
        penaltiesMinor: 10_000,
      }),
    ]);
    renderPage(OWNER);
    await waitFor(() => {
      expect(text(entry('Basile', 'Malus'))).toContain('−60,00 €retenu −23,34 € (plafonné)');
    });
    expect(text(entry('Théo', 'Malus en pourcentage'))).toContain('−10 %de son net, soit −100,00 €');
    // The cap is on the share plus bonuses, not on the total: a negative carry-over may still leave it under zero.
    expect(
      screen.getByText(/^Un malus est plafonné à la part du membre plus ses primes de la quinzaine/u),
    ).toBeTruthy();
    expect(screen.queryByText(/jamais passer un relevé sous zéro/u)).toBeNull();
  });

  it('cancels a bonus only once confirmed, and keeps it struck through', async () => {
    answer = () => ({
      status: 200,
      body: {
        ...THEO_BONUS,
        cancellation: { cancelledAt: '2026-11-12T13:00:00.000Z', cancelledBy: OWNER_USER },
      },
    });
    renderPage(OWNER);
    await screen.findByText('« A formé Lou aux relances, deux soirs. »');
    const theo = entry('Théo', 'Prime');
    fireEvent.click(within(theo).getByRole('button', { name: /^Annuler la prime/u }));
    const confirm = within(theo).getByRole('alertdialog');
    expect(text(confirm)).toContain(
      'Annuler la prime de +30,00 € de Théo ? Son relevé de la quinzaine est recalculé ; la saisie reste, barrée.',
    );
    // The focus goes to the answer that changes nothing, then back to « Annuler » once kept.
    expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: 'Garder' }));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Garder' }));
    expect(within(theo).queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(within(theo).getByRole('button', { name: /^Annuler la prime/u }));
    expect(writes).toEqual([]);

    fireEvent.click(within(theo).getByRole('button', { name: /^Annuler la prime/u }));
    entries[NOV1] = entriesOf(NOV1, {
      bonuses: [
        { ...THEO_BONUS, cancellation: { cancelledAt: '2026-11-12T13:00:00.000Z', cancelledBy: OWNER_USER } },
      ],
    });
    // Cancelled, but the list is not read again yet: the row stays busy, « Annuler » never comes back on it.
    let release = (): void => undefined;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.click(within(theo).getByRole('button', { name: 'Annuler la prime' }));
    expect(await within(theo).findByRole('button', { name: 'Annulation…' })).toBeTruthy();
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(within(theo).getByRole('button', { name: 'Annulation…' }).hasAttribute('disabled')).toBe(true);
    gate = null;
    release();
    await waitFor(() => {
      expect(entry('Théo', 'Prime').dataset['cancelled']).toBe('true');
    });
    expect(writes).toEqual([{ path: `/v1/payroll/bonuses/${THEO_BONUS.id}/cancel`, body: {} }]);
    expect(text(entry('Théo', 'Prime'))).toContain('annulé par Charles le jeu. 12 nov.');
  });

  it('adds a penalty in two steps, never for oneself, the same entry sent again after a refusal', async () => {
    let refuse = true;
    answer = (path) => {
      if (refuse) {
        refuse = false;
        return { status: 409, body: refusal('pay_period_closed_conflict', { period: NOV1 }) };
      }
      return {
        status: 201,
        body: penaltyOf(9, LOU, NOV1, { amount: { kind: 'fixed', amountMinor: 2_000 }, reason: path }),
      };
    };
    renderPage(IRIS_ME);
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Malus' }));
    expect(text(within(dialog).getByRole('heading'))).toBe('Ajouter un malus');
    const member = within(dialog).getByLabelText('Pour');
    expect([...member.querySelectorAll('option')].map((one) => one.textContent)).toEqual([
      'Choisir un membre',
      'Basile',
      'Lou',
      'Théo',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(within(dialog).getByText('Le motif est obligatoire.'))).toBeTruthy();

    fireEvent.change(member, { target: { value: LOU.id } });
    // October's second half is closed and Lou had nothing there: the one period open for an entry is the one under way.
    const periodChips = await within(dialog).findAllByRole('radio', { name: /octobre|novembre/u });
    expect(periodChips.map((one) => [text(one), one.getAttribute('aria-checked')])).toEqual([
      ['1er – 15 novembre', 'true'],
    ]);
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Deux fans relancés trois fois le même soir.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(await within(dialog).findByText(/^Malus de/u))).toBe(
      'Malus de 20,00 € pour Lou, sur la quinzaine du 1er au 15 novembre : « Deux fans relancés trois fois le même soir. »',
    );
    expect(text(within(dialog).getByText(/^Plafonné/u))).toBe(
      'Plafonné à sa part plus ses primes : son relevé reste au moins à 0 €. Lou le lira avec son relevé.',
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter le malus' }));
    expect(text(await within(dialog).findByRole('alert'))).toBe(
      'La quinzaine du 1er au 15 novembre est déjà validée.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Ajouter le malus' }));
    expect(text(await screen.findByRole('status'))).toBe(
      'Malus de 20,00 € pour Lou ajouté sur la quinzaine du 1er au 15 novembre.',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    const [first, second] = writes;
    expect(first?.path).toBe('/v1/payroll/penalties');
    expect(first?.body).toEqual({
      id: AN_ID,
      memberId: LOU.id,
      fromPeriod: NOV1,
      toPeriod: NOV1,
      amount: { kind: 'fixed', amountMinor: 2_000 },
      reason: 'Deux fans relancés trois fois le même soir.',
    });
    expect(second?.body).toEqual(first?.body);
  });

  it('says where an adjustment goes before sending it — the member’s next statement to validate — and opens that period', async () => {
    periods[OCT2] = periodOf(
      OCT2,
      [statementOf(THEO, OCT2, { status: 'validated', canValidate: false }), statementOf(LOU, OCT2)],
      { closing: CLOSED },
    );
    answer = () => ({ status: 201, body: adjustmentOf(9, LOU, OCT2) });
    renderPage(OWNER);
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Ajustement' }));
    fireEvent.change(within(dialog).getByLabelText('Pour'), { target: { value: LOU.id } });
    expect(text(await within(dialog).findByText(/^Il va sur la quinzaine/u))).toBe(
      'Il va sur la quinzaine du 16 au 31 octobre : la prochaine de Lou à valider.',
    );
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Retirer' }));
    fireEvent.change(within(dialog).getByLabelText('Montant'), { target: { value: '12,40' } });
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Rapport du 28 oct. compté deux fois.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(text(await within(dialog).findByText(/^Ajustement de/u))).toBe(
      'Ajustement de −12,40 € pour Lou, sur sa quinzaine du 16 au 31 octobre, la prochaine à valider : « Rapport du 28 oct. compté deux fois. »',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter l’ajustement' }));
    expect(text(await screen.findByRole('status'))).toBe(
      'Ajustement de −12,40 € pour Lou ajouté sur la quinzaine du 16 au 31 octobre.',
    );
    expect(screen.getByText('16 – 31 octobre 2026')).toBeTruthy();
    expect(writes).toEqual([
      {
        path: '/v1/payroll/adjustments',
        body: {
          id: AN_ID,
          memberId: LOU.id,
          amountMinor: -1_240,
          reason: 'Rapport du 28 oct. compté deux fois.',
          correctsStatementId: null,
        },
      },
    ]);
  });

  it('says an empty period, and a server that does not answer, never one for the other', async () => {
    entries = {};
    renderPage(OWNER);
    expect(await screen.findByText('Aucune prime ni aucun malus sur cette quinzaine.')).toBeTruthy();
    cleanup();

    entries = { [NOV1]: 'down' };
    renderPage(OWNER);
    expect(
      await screen.findByText('Le serveur ne répond pas : la liste des saisies n’a pas pu être lue.'),
    ).toBeTruthy();
    expect(screen.queryByText('Aucune prime ni aucun malus sur cette quinzaine.')).toBeNull();
  });
});
