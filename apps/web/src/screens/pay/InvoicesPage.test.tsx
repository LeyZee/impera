// @vitest-environment jsdom
import type { InvoiceListItem, Me, PayrollPeriod } from '@impera/contracts';
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

import { InvoicesPage, type InvoicesFilter } from './InvoicesPage';

import {
  BASILE,
  invoiceOf,
  IRIS,
  IRIS_ME,
  LOU,
  MEMBERS,
  OCT1,
  OCT2,
  OWNER,
  payId,
  periodOf,
  SCHEDULING_SETTINGS,
  statementOf,
  THEO,
} from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;

const CONTESTED: InvoiceListItem['acceptance'] = {
  state: 'contested',
  deadline: '2026-11-09T22:59:00.000Z',
  reason: 'Il manque un rapport.',
};

/** Lou contests her invoice of the second half of October; Basile's is soon due, Théo's of the first half is late. */
const LOU_CONTESTED = invoiceOf(1, LOU, OCT2, { acceptance: CONTESTED });
const BASILE_SOON = invoiceOf(2, BASILE, OCT2, { due: 'soon', dueOn: '2026-11-10' });
const THEO_LATE = invoiceOf(3, THEO, OCT1, { issuedOn: '2026-09-02', dueOn: '2026-11-01', due: 'overdue' });
/** A credit note owed by the second half of October that corrects the first. */
const THEO_CREDIT = invoiceOf(4, THEO, OCT1, {
  kind: 'credit_note',
  creditedInvoiceId: THEO_LATE.id,
  statementPeriod: OCT2,
  exclVatMinor: -2_500,
  inclVatMinor: -2_500,
});

let lists: (search: URLSearchParams) => InvoiceListItem[];
/** The quinzaine's statements as the period's read gives them; `null` answers like a period not found. */
let period: PayrollPeriod | null;
const reads: string[] = [];
const writes: { path: string; body: unknown }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        writes.push({
          path: url.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        });
        return json({
          invoiceId: LOU_CONTESTED.id,
          kind: 'invoice',
          memberId: LOU.id,
          number: LOU_CONTESTED.number,
          acceptance: { ...CONTESTED, state: 'contest_upheld' },
          events: [
            {
              id: payId(990),
              invoiceId: LOU_CONTESTED.id,
              kind: 'issued',
              reason: null,
              statementId: null,
              by: null,
              at: '2026-11-02T09:00:00.000Z',
            },
          ],
        });
      }
      switch (url.pathname) {
        case '/v1/payroll/invoices':
          reads.push(url.search);
          return json({ today: '2026-11-05', documents: lists(url.searchParams) });
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        case '/v1/team/members':
          return json({ members: MEMBERS });
        case `/v1/payroll/periods/${OCT2}`:
          if (period !== null) return json(period);
          return json({ items: [], nextCursor: null });
        default:
          return json({ items: [], nextCursor: null });
      }
    }),
  );
}

function renderPage(user: Me, member: string | null = null): { filters: InvoicesFilter[] } {
  const filters: InvoicesFilter[] = [];
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/factures',
    component: () => (
      <InvoicesPage
        user={user}
        chosen={null}
        member={member}
        onFilter={(filter) => {
          filters.push(filter);
        }}
      />
    ),
  });
  const statements = createRoute({
    getParentRoute: () => root,
    path: '/paie/quinzaine',
    component: () => null,
  });
  const file = createRoute({
    getParentRoute: () => root,
    path: '/equipe/membres/$memberId/dossier',
    component: () => null,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, statements, file]),
    history: createMemoryHistory({ initialEntries: ['/paie/factures'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { filters };
}

const panelOf = (title: string): HTMLElement => {
  const panel = screen.getByRole('heading', { name: title }).closest('section');
  if (panel === null) throw new Error(`No panel ${title}`);
  return panel;
};
const rowIn = (panel: HTMLElement, number: string): HTMLElement => {
  const row = within(panel).getByText(number).closest('article');
  if (row === null) throw new Error(`No row for ${number}`);
  return row;
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
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  lists = (search) => {
    if (search.get('acceptance') === 'contested') return [LOU_CONTESTED];
    if (search.get('due') === 'soon,overdue') return [BASILE_SOON, THEO_LATE];
    if (search.get('period') === OCT2) return [LOU_CONTESTED, BASILE_SOON, THEO_CREDIT];
    return [];
  };
  period = null;
  reads.length = 0;
  writes.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Paie › Factures', () => {
  it('puts the contests first, then the due dates in amber and red, then the last quinzaine ended', async () => {
    renderPage(OWNER);
    const contests = await waitFor(() => panelOf('Contestations à trancher'));
    const contested = rowIn(contests, LOU_CONTESTED.number);
    expect(contested.textContent.replace(NBSP, ' ')).toContain(
      'Motif du prestataire : « Il manque un rapport. »',
    );
    expect(contested.textContent).toContain('Lou');
    expect(within(contested).getByRole('button', { name: 'Trancher' })).toBeTruthy();

    const dues = panelOf('Échéances proches ou passées');
    const soon = rowIn(dues, BASILE_SOON.number);
    expect(within(soon).getByText('Bientôt due').className).toBe('rp-chip rp-chip--warn');
    expect(soon.dataset['due']).toBe('soon');
    const late = rowIn(dues, THEO_LATE.number);
    expect(within(late).getByText('En retard').className).toBe('rp-chip iv-chip--danger');
    expect(late.dataset['due']).toBe('overdue');
    expect(within(late).getByRole('link', { name: 'Voir le relevé' }).getAttribute('href')).toBe(
      `/paie/quinzaine?quinzaine=${OCT1}&membre=${THEO.id}`,
    );

    const documents = await waitFor(() => panelOf('16 – 31 octobre 2026'));
    await waitFor(() => rowIn(documents, THEO_CREDIT.number));
    expect(reads).toContain(`?period=${OCT2}`);
    const credit = rowIn(documents, THEO_CREDIT.number);
    expect(credit.textContent.replace(NBSP, ' ')).toContain('corrige la quinzaine du 1er au 15 octobre 2026');
    expect(credit.textContent.replace(NBSP, ' ')).toContain('−25,00 €');
    // Its statement is the one that owed it, as the server says: not the quinzaine it corrects.
    expect(within(credit).getByRole('link', { name: 'Voir le relevé' }).getAttribute('href')).toBe(
      `/paie/quinzaine?quinzaine=${OCT2}&membre=${THEO.id}`,
    );
  });

  it('names the validated statements whose invoice waits, and why (recette EQP-04)', async () => {
    const held = {
      status: 'validated' as const,
      validatedAt: '2026-11-02T08:41:00.000Z',
      payableMinor: 22_169,
      totalMinor: 22_169,
      payoutBlock: { reason: 'documents_not_issued' as const, year: null },
    };
    period = periodOf(OCT2, [
      statementOf(THEO, OCT2, { ...held, notIssuedReason: 'no_mandate' }),
      // A transfer that waits for a certificate is not about its invoice: not listed here.
      statementOf(BASILE, OCT2, { ...held, payoutBlock: { reason: 'tax_residence_missing', year: '2026' } }),
    ]);
    renderPage(OWNER);
    const panel = await waitFor(() => panelOf('1 relevé validé sans facture'));
    const theo = within(panel).getByText('Théo').closest('article');
    if (theo === null) throw new Error('No row for Théo');
    expect(theo.textContent.replace(NBSP, ' ')).toContain('221,69 €à verser');
    expect(theo.textContent).toContain(
      'Versement bloqué : facture pas encore émise, le membre n’a pas encore accepté son mandat de facturation.',
    );
    expect(within(theo).getByRole('link', { name: 'Ouvrir son dossier' }).getAttribute('href')).toBe(
      `/equipe/membres/${THEO.id}/dossier`,
    );
    expect(within(panel).queryByText('Basile')).toBeNull();
  });

  it('upholds a contest with one amount whose side is chosen in words, checked before it leaves', async () => {
    renderPage(OWNER);
    const contests = await waitFor(() => panelOf('Contestations à trancher'));
    fireEvent.click(within(rowIn(contests, LOU_CONTESTED.number)).getByRole('button', { name: 'Trancher' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Donner raison' }));
    expect(within(dialog).getByRole('radio', { name: 'Annuler et refacturer' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).getByText('Choisis en faveur de qui.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'En faveur de l’agence' }));
    fireEvent.change(within(dialog).getByLabelText('Montant hors taxes'), { target: { value: '12,50' } });
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Rapport compté deux fois.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    const check = await screen.findByRole('dialog');
    expect(check.textContent.replace(NBSP, ' ')).toContain(
      'Tu donnes raison à Lou : un avoir de 12,50 € HT sur la facture, à la prochaine validation.',
    );
    expect(writes).toEqual([]);
    fireEvent.click(within(check).getByRole('button', { name: 'Donner raison' }));
    await waitFor(() => {
      expect(writes).toEqual([
        {
          path: `/v1/payroll/invoices/${LOU_CONTESTED.id}/contest/uphold`,
          body: { reason: 'Rapport compté deux fois.', correction: { kind: 'amount', amountMinor: -1_250 } },
        },
      ]);
    });
  });

  it('refuses a contest with a reason, and never offers to cancel and reissue a credit note', async () => {
    const contestedCredit = { ...THEO_CREDIT, acceptance: CONTESTED } satisfies InvoiceListItem;
    lists = (search) => (search.get('acceptance') === 'contested' ? [contestedCredit] : []);
    renderPage(OWNER);
    const contests = await waitFor(() => panelOf('Contestations à trancher'));
    fireEvent.click(within(rowIn(contests, THEO_CREDIT.number)).getByRole('button', { name: 'Trancher' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Donner raison' }));
    expect(within(dialog).queryByRole('radio', { name: 'Annuler et refacturer' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Refuser la contestation' }));
    fireEvent.change(within(dialog).getByLabelText('Motif'), {
      target: { value: 'Le rapport est sur la quinzaine suivante.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Refuser' }));
    await waitFor(() => {
      expect(writes).toEqual([
        {
          path: `/v1/payroll/invoices/${THEO_CREDIT.id}/contest/refuse`,
          body: { reason: 'Le rapport est sur la quinzaine suivante.' },
        },
      ]);
    });
  });

  it('lets a manager read the contests, never settle them, and answer his own documents', async () => {
    const irisPending = invoiceOf(5, IRIS, OCT2, {
      acceptance: { state: 'pending', deadline: '2026-11-09T22:59:00.000Z', reason: null },
    });
    lists = (search) => {
      if (search.get('acceptance') === 'contested') return [LOU_CONTESTED];
      if (search.get('period') === OCT2) return [irisPending, BASILE_SOON];
      return [];
    };
    renderPage({ ...IRIS_ME, id: IRIS.userId });
    const contests = await waitFor(() => panelOf('Contestations à trancher'));
    expect(within(contests).getByText('Le propriétaire les tranche.')).toBeTruthy();
    expect(within(contests).queryByRole('button', { name: 'Trancher' })).toBeNull();
    const documents = await waitFor(() => panelOf('16 – 31 octobre 2026'));
    const own = await waitFor(() => rowIn(documents, irisPending.number));
    expect(within(own).getByRole('button', { name: 'J’accepte' })).toBeTruthy();
    expect(
      within(rowIn(documents, BASILE_SOON.number)).queryByRole('button', { name: 'J’accepte' }),
    ).toBeNull();
  });

  it('reads one member over a year, chosen in the list of the team', async () => {
    const { filters } = renderPage(OWNER);
    const select = await screen.findByLabelText('Membre');
    await waitFor(() => within(select).getByRole('option', { name: 'Théo' }));
    fireEvent.change(select, { target: { value: THEO.id } });
    expect(filters).toEqual([{ membre: THEO.id }]);
    cleanup();
    lists = (search) => (search.get('memberId') === THEO.id && search.has('from') ? [THEO_CREDIT] : []);
    renderPage(OWNER, THEO.id);
    const year = await waitFor(() => panelOf('Théo, sur l’année'));
    // Read outside its quinzaine, a credit note still leads to the statement that owed it.
    const credit = await waitFor(() => rowIn(year, THEO_CREDIT.number));
    expect(within(credit).getByRole('link', { name: 'Voir le relevé' }).getAttribute('href')).toBe(
      `/paie/quinzaine?quinzaine=${OCT2}&membre=${THEO.id}`,
    );
    await waitFor(() => {
      expect(reads).toContain(`?memberId=${THEO.id}&from=2025-11-05&to=2026-11-05`);
    });
    expect(reads).toContain(`?acceptance=contested&memberId=${THEO.id}`);
    expect(screen.queryByRole('button', { name: 'Quinzaine précédente' })).toBeNull();
  });
});
