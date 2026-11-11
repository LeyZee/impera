// @vitest-environment jsdom
import { ValidateShiftReportsBodySchema } from '@impera/contracts';
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

import { ReportsPage } from './ReportsPage';

import { HoldProvider } from '@/reports/Hold';
import { ReopenProvider } from '@/reports/reopen';
import { settingsOf } from '@/test/settings';

/** The reader's own zone: Paris, unless a test reads the page from elsewhere. */
const reader = vi.hoisted(() => ({ zone: 'Europe/Paris' }));
vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => reader.zone,
}));

/* Invented people (ADR 0010). Now: 01:00 on 28 October in Paris, period 16–31. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const THEO = id(21);
const BASILE = id(22);
const ACCOUNT = {
  id: id(11),
  creatorId: id(1),
  creatorName: 'Nora Vidal',
  platform: 'reveal',
  handle: 'nora',
  archived: false,
};
const MEMBERS = [
  { id: THEO, displayName: 'Théo', color: null },
  { id: BASILE, displayName: 'Basile', color: null },
];

/** The team as `/v1/team/members` reads it: each member's own zone and status, for « Relancer ». */
const teamMember = (memberId: string, name: string, status = 'active'): Record<string, unknown> => ({
  id: memberId,
  userId: id(Number(memberId.slice(-3)) + 50),
  email: `member${memberId.slice(-3)}@example.test`,
  firstName: name,
  lastName: 'Martin',
  displayName: name,
  teamRole: 'chatter',
  status,
  country: 'FR',
  timeZone: 'Europe/Paris',
  color: null,
  joinedOn: '2026-09-01',
  creatorIds: [id(1)],
  commission: null,
  invitationPending: false,
  invitationExpiresAt: null,
});
let team: { status: number; body: unknown };
/** A period whose list the server does not answer. */
let downPeriod: string | null;

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replaceAll('\u00a0', ' ');

const shift = (n: number, memberId: string, day: number) => ({
  id: id(100 + n),
  creatorId: id(1),
  platformAccountId: id(11),
  memberId,
  startsAt: `2026-10-${String(day)}T16:00:00.000Z`,
  endsAt: `2026-10-${String(day)}T22:00:00.000Z`,
  templateId: null,
  stoppedAt: null,
});
const SHIFTS = [shift(1, THEO, 26), shift(2, BASILE, 26), shift(3, THEO, 25), shift(4, BASILE, 24)];

interface FakeReport {
  readonly id: string;
  readonly status: string;
  readonly [key: string]: unknown;
}

const report = (n: number, shiftIndex: number, patch: Record<string, unknown> = {}): FakeReport => {
  const ofShift = SHIFTS[shiftIndex] ?? SHIFTS[0];
  return {
    id: id(300 + n),
    shiftId: ofShift?.id,
    creatorId: id(1),
    platformAccountId: id(11),
    memberId: ofShift?.memberId,
    period: '2026-10-16',
    correctsId: null,
    amount: { amountMinor: 10_000 + n * 1_000, currency: 'EUR' },
    comment: null,
    incident: null,
    status: 'submitted',
    version: 1,
    byAgency: false,
    reviewKind: null,
    explanation: null,
    check: null,
    canReview: true,
    submittedAt: '2026-10-27T00:00:00.000Z',
    reviewedAt: null,
    reviewNote: null,
    createdAt: '2026-10-27T00:00:00.000Z',
    ...patch,
  };
};

let open: FakeReport[];
let period: FakeReport[];
/** The pay rules of the period for the shift corrected. */
let rules: unknown;
/** What a `POST` answers: the same for each, or from what it was sent. */
let answer: { status: number; body: unknown } | ((body: unknown) => { status: number; body: unknown });
const writes: { method: string; path: string; body: unknown }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        writes.push({ method: init.method, path: url.pathname, body });
        const answered = typeof answer === 'function' ? answer(body) : answer;
        return json(answered.body, answered.status);
      }
      switch (url.pathname) {
        case '/v1/scheduling/settings':
          return json(settingsOf());
        case '/v1/team/members':
          return json(team.body, team.status);
        case '/v1/scheduling/shift-reports':
          if (downPeriod !== null && url.searchParams.get('period') === downPeriod) return json(null, 500);
          return json(
            url.searchParams.has('period')
              ? url.searchParams.get('period') === '2026-10-16'
                ? { reports: period, shifts: SHIFTS, accounts: [ACCOUNT], members: MEMBERS }
                : { reports: [], shifts: [], accounts: [], members: [] }
              : { reports: open, shifts: SHIFTS, accounts: [ACCOUNT], members: MEMBERS },
          );
        case `/v1/scheduling/shifts/${id(101)}/report`:
          return json({
            shift: SHIFTS[0],
            account: ACCOUNT,
            period: '2026-10-16',
            opensAt: '2026-10-26T21:30:00.000Z',
            rules,
            reports: period.filter((one) => one['shiftId'] === id(101)),
          });
        default:
          return json(null, 404);
      }
    }),
  );
}

/** Every report of the batch validated, as the server answers it. */
const validatesAll = (body: unknown): { status: number; body: unknown } => {
  const sent = ValidateShiftReportsBodySchema.parse(body).reports;
  return {
    status: 200,
    body: {
      results: sent.map((one) => ({
        outcome: 'validated',
        report: { ...report(0, 0), id: one.id, status: 'validated', version: one.version + 1 },
      })),
    },
  };
};

/** Renders the page, and gives the way to Suivi, as the rail would take it. */
function renderPage(focus: string | null = null): () => Promise<void> {
  // The app's one hold, as the shell mounts it, and Suivi to leave Équipe › Rapports for.
  const root = createRootRoute({
    component: () => (
      <HoldProvider>
        <ReopenProvider>
          <Outlet />
        </ReopenProvider>
      </HoldProvider>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/equipe/rapports',
    component: () => <ReportsPage owner member={focus} />,
  });
  const tracking = createRoute({ getParentRoute: () => root, path: '/suivi', component: () => <p>Suivi</p> });
  const router = createRouter({
    routeTree: root.addChildren([page, tracking]),
    history: createMemoryHistory({ initialEntries: ['/equipe/rapports'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return () => router.navigate({ to: '/suivi' });
}

beforeEach(() => {
  // Équipe's tabs move their lens when the page comes back, under the reader's motion setting.
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // Équipe's tabs watch their own width.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
  writes.length = 0;
  team = { status: 200, body: { members: [teamMember(THEO, 'Théo'), teamMember(BASILE, 'Basile')] } };
  downPeriod = null;
  open = [
    report(1, 0, { comment: 'Un pack a bien plu' }),
    report(2, 1, { incident: 'Le compte a été déconnecté une heure' }),
    report(3, 2, { canReview: false }),
  ];
  period = [];
  rules = null;
  answer = { status: 200, body: { results: [] } };
  serve();
});

afterEach(() => {
  cleanup();
  reader.zone = 'Europe/Paris';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Équipe › Rapports', () => {
  it('counts what waits, oldest shift first, says the incident, and keeps out of the batch what the reader may not review', async () => {
    renderPage();
    // Its own shift is not the reader's to decide: the tab counts 2, and the page says why it differs.
    const panel = (await screen.findByText('rapports attendent, dont 2 à décider maintenant')).closest(
      'section',
    );
    expect(panel?.textContent).toContain('3');
    const tab = within(screen.getByRole('navigation', { name: 'Équipe' })).getByRole('link', {
      name: /^Rapports/u,
    });
    expect(tab.textContent).toContain('2, 2 à décider maintenant');
    expect(screen.getByText('Le compte a été déconnecté une heure')).toBeTruthy();
    expect(screen.getByText('Ton propre shift : un autre membre de l’agence le valide.')).toBeTruthy();

    // No « Valider » until something is chosen, then at the foot of the list (EQ-26).
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBe(null);
    fireEvent.click(screen.getByLabelText('Tout sélectionner'));
    const bar = screen.getByRole('button', { name: 'Valider (2)' }).closest('.rp-validate__bar');
    expect(text(bar)).toContain('2 rapports choisis');
    expect(
      screen
        .getAllByRole('checkbox', { name: /Sélectionner le rapport de Théo/u })
        .map((box) => box.matches(':disabled')),
    ).toEqual([true, false]);
  });

  it('validates the selection after five seconds, each report with the version it read', async () => {
    answer = {
      status: 200,
      body: {
        results: [
          {
            outcome: 'validated',
            report: {
              ...report(1, 0),
              status: 'validated',
              version: 2,
              reviewedAt: '2026-10-28T00:00:05.000Z',
            },
          },
          { outcome: 'refused', id: id(302), code: 'shift_report_changed_conflict' },
        ],
      },
    };
    renderPage();
    fireEvent.click(await screen.findByLabelText('Tout sélectionner'));
    fireEvent.click(screen.getByRole('button', { name: 'Valider (2)' }));

    expect(await screen.findByText(/Validation de 2 rapports dans 5\ss/u)).toBeTruthy();
    // Held in place, out of the selection, until they are sent.
    expect(screen.getAllByText('En validation')).toHaveLength(2);
    // Nothing chosen any more: no greyed « Valider » left in the header (EQ-26).
    expect(screen.queryByRole('button', { name: /^Valider/u })).toBeNull();
    expect(writes).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(writes).toEqual([
      {
        method: 'POST',
        path: '/v1/scheduling/shift-reports/validate',
        body: {
          reports: [
            { id: id(301), version: 1 },
            { id: id(302), version: 1 },
          ],
        },
      },
    ]);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('1 validé, 1 refusé');
    // The refused one is named, with its shift.
    expect(alert.textContent).toContain('Le rapport de Basile (');
    expect(alert.textContent).toContain('ce rapport ou son shift a changé depuis qu’il a été lu');
  });

  it('keeps a second validation held while the first is answered, and says the first one’s refusal', async () => {
    answer = (body) => ({
      status: 200,
      body: {
        results: ValidateShiftReportsBodySchema.parse(body).reports.map((one) => ({
          outcome: 'refused',
          id: one.id,
          code: 'shift_report_changed_conflict',
        })),
      },
    });
    renderPage();
    const [theo] = (
      await screen.findAllByRole('checkbox', { name: /Sélectionner le rapport de Théo/u })
    ).filter((box) => !box.matches(':disabled'));
    if (theo === undefined) throw new Error('no box');
    fireEvent.click(theo);
    fireEvent.click(screen.getByRole('button', { name: 'Valider (1)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Sélectionner le rapport de Basile/u }));
    // The second hold sends the first at once.
    fireEvent.click(screen.getByRole('button', { name: 'Valider (1)' }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(writes).toHaveLength(1);
    // Answered, the first gives back its own row and leaves the second's held.
    expect(screen.getAllByText('En validation')).toHaveLength(1);
    expect(
      screen.getByRole('checkbox', { name: /Sélectionner le rapport de Basile/u }).matches(':disabled'),
    ).toBe(true);
    // Its refusal has its own island, above the second one counting down.
    expect((await screen.findByRole('alert')).textContent).toContain('Le rapport de Théo (');
    expect(screen.getByText(/Validation du rapport dans/u)).toBeTruthy();
  });

  it('validates more than a batch holds in batches of 100, under one hold', async () => {
    open = Array.from({ length: 101 }, (_, n) => report(n + 1, n % 2));
    answer = validatesAll;
    renderPage();
    // By their text: over 101 rows, a label or role query has jsdom pair every label with its control (seconds on CI).
    fireEvent.click(await screen.findByText('Tout sélectionner'));
    fireEvent.click(screen.getByText('Valider (101)'));
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(writes.map((one) => ValidateShiftReportsBodySchema.parse(one.body).reports.length)).toEqual([
      100, 1,
    ]);
    expect((await screen.findByText('101 rapports validés')).closest('[role="status"]')).toBeTruthy();
  });

  it('gives the selection back on « Annuler », with nothing sent', async () => {
    renderPage();
    fireEvent.click(await screen.findByLabelText('Tout sélectionner'));
    fireEvent.click(screen.getByRole('button', { name: 'Valider (2)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    await act(() => vi.advanceTimersByTimeAsync(6_000));

    expect(writes).toEqual([]);
    expect(screen.getByRole('button', { name: 'Valider (2)' })).toBeTruthy();
  });

  it('sends a report back with a word, at once', async () => {
    answer = { status: 200, body: { ...report(1, 0), status: 'rejected', version: 2, reviewNote: 'x' } };
    renderPage();
    const row = (await screen.findByText('« Un pack a bien plu »')).closest('li');
    if (row === null) throw new Error('no row');
    fireEvent.click(within(row).getByRole('button', { name: 'Renvoyer' }));
    const send = within(row).getByRole('button', { name: 'Renvoyer avec ce mot' });
    expect(send.matches(':disabled')).toBe(true);
    fireEvent.change(within(row).getByLabelText('Ce que Théo doit revoir'), {
      target: { value: ' Il manque le pourboire ' },
    });
    fireEvent.click(send);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(writes).toEqual([
      {
        method: 'POST',
        path: `/v1/scheduling/shift-reports/${id(301)}/reject`,
        body: { version: 1, note: 'Il manque le pourboire' },
      },
    ]);
  });

  it('says « 0,00 € validés » of a report validated at nothing, never a blank row (recette EQP-14)', async () => {
    period = [
      report(5, 1, {
        status: 'validated',
        amount: { amountMinor: 0, currency: 'EUR' },
        reviewedAt: '2026-10-27T08:00:00.000Z',
      }),
    ];
    renderPage();
    const basile = await screen.findByText('Basile', { selector: '.nv-disclosure__title' });
    expect(text(basile.closest('summary')?.querySelector('.nv-disclosure__sum') ?? null)).toMatch(
      /^0,00 € validés/u,
    );
  });

  it('reads a period member by member, with the shifts still without a report', async () => {
    period = [
      report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' }),
      report(6, 1, { status: 'submitted' }),
    ];
    renderPage();
    const theo = await screen.findByText('Théo', { selector: '.nv-disclosure__title' });
    const summary = theo.closest('summary');
    expect((summary?.textContent ?? '').replaceAll(/\s/gu, ' ')).toContain(
      '150,00 € validés · 1 sans rapport',
    );
    // Only the shifts without a report are amber, not the money beside them (EQ-14).
    expect(text(summary?.querySelector('.rp-member__late') ?? null)).toBe(' · 1 sans rapport');
    // The period is the panel's title, as on Paie, its arrows beside it (recette #561).
    expect(screen.getByRole('heading', { name: '16 – 31 octobre 2026' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Quinzaine suivante' }).matches(':disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Cette quinzaine' })).toBe(null);

    fireEvent.click(screen.getByRole('button', { name: 'Corriger' }));
    const dialog = await screen.findByRole('dialog', { name: 'Corriger le rapport de Théo' });
    // No rules for the period: the owner is led to them, never told to warn the agency.
    expect(await within(dialog).findByText('Pas encore de règles de paie')).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Poser les règles' })).toBeTruthy();
    expect(dialog.textContent).not.toContain('Préviens l’agence');
  });

  it('says the shifts without a report at a glance, oldest first, and copies a word to send (EQ-14, EQ-15)', async () => {
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    const copied: string[] = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          copied.push(value);
          return Promise.resolve();
        },
      },
    });
    renderPage();
    const late = (await screen.findByText('3 shifts sans rapport')).closest('details');
    if (!(late instanceof HTMLDetailsElement)) throw new Error('no late fold');
    // The fold says its window: older shifts without a report exist, pay carries a late one (ADR 0023).
    expect(text(late.querySelector('summary'))).toContain(
      'le plus ancien depuis 3 jours · cette quinzaine et la précédente',
    );
    const rows = [...late.querySelectorAll('.rp-late__one')].map((row) => text(row));
    expect(rows[0]).toMatch(/^Basilesam\. 24 oct\./u);
    expect(rows[1]).toMatch(/^Théodim\. 25 oct\./u);
    expect(rows[2]).toMatch(/^Basilelun\. 26 oct\./u);
    fireEvent.click(within(late).getAllByRole('button', { name: 'Relancer Basile' })[0] ?? late);
    await within(late).findByRole('button', { name: 'Message copié pour Basile' });
    // Said once for the page, in a zone that was there and empty before.
    const said = (): string[] => screen.getAllByRole('status').map((zone) => text(zone));
    expect(said().some((one) => one.startsWith('Message pour Basile copié, shift du sam. 24 oct.'))).toBe(
      true,
    );
    // A second word for the same member says its own shift: the zone's text changes, so it is said again.
    // The first now says « Message copié »: the one left to relance is his Monday.
    fireEvent.click(within(late).getByRole('button', { name: 'Relancer Basile' }));
    await waitFor(() => {
      expect(said().some((one) => one.startsWith('Message pour Basile copié, shift du lun. 26 oct.'))).toBe(
        true,
      );
    });
    expect(copied[0]).toMatch(
      /^Basile, ton rapport du sam\. 24 oct\. · 18\sh – 0\sh \(Nora Vidal\) n’est pas encore fait\. Fais-le dans Impera dès que tu peux\.$/u,
    );
  });

  it('shows the word to copy by hand, selected, when there is no clipboard', async () => {
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error('denied')) },
    });
    renderPage();
    const late = (await screen.findByText('3 shifts sans rapport')).closest('details');
    if (!(late instanceof HTMLDetailsElement)) throw new Error('no late fold');
    late.open = true;
    fireEvent.click(within(late).getAllByRole('button', { name: 'Relancer Basile' })[0] ?? late);
    const word = await within(late).findByRole<HTMLTextAreaElement>('textbox', {
      name: 'Message pour Basile, à copier',
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(word);
    });
    expect(word.selectionEnd - word.selectionStart).toBe(word.value.length);
  });

  it('says « Parti » for a member who left, and keeps « Relancer » until the team is read', async () => {
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    team = {
      status: 200,
      body: { members: [teamMember(THEO, 'Théo'), teamMember(BASILE, 'Basile', 'left')] },
    };
    renderPage();
    const late = (await screen.findByText('3 shifts sans rapport')).closest('details') ?? document.body;
    await within(late).findAllByText('Parti');
    expect(within(late).queryByRole('button', { name: 'Relancer Basile' })).toBeNull();
    expect(within(late).getByRole('button', { name: 'Relancer Théo' })).toBeTruthy();
    // The period says it beside his name, the fold closed: his last one (recette EQP-17).
    const summaries = [...document.querySelectorAll('.rp-period .rp-member > summary')];
    const basile = summaries.find(
      (one) => one.querySelector('.nv-disclosure__title')?.textContent === 'Basile',
    );
    const theo = summaries.find((one) => one.querySelector('.nv-disclosure__title')?.textContent === 'Théo');
    expect(basile?.querySelector('.rp-chip--neutral')?.textContent).toBe('Parti');
    expect(theo?.querySelector('.rp-chip--neutral')).toBeNull();
  });

  it('says why « Relancer » waits when the team cannot be read, and when the late shifts cannot be', async () => {
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    team = { status: 503, body: null };
    downPeriod = '2026-10-01';
    renderPage();
    expect(
      await screen.findByText(
        'Les fiches des membres n’ont pas pu être lues : « Relancer » attend leurs heures.',
        {},
        { timeout: 4_000 },
      ),
    ).toBeTruthy();
    expect(await screen.findByText('Les shifts sans rapport n’ont pas pu être lus.')).toBeTruthy();
    expect(screen.queryByText('3 shifts sans rapport')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Relancer/u })).toBeNull();
  });

  it('says so when the member asked has no shift on the period', async () => {
    const lou = id(23);
    team = {
      status: 200,
      body: { members: [teamMember(THEO, 'Théo'), teamMember(BASILE, 'Basile'), teamMember(lou, 'Lou')] },
    };
    renderPage(lou);
    expect(await screen.findByText('Pas de shift de Lou sur cette quinzaine.')).toBeTruthy();
  });

  it('reads the shifts at the agency’s hour, the report opened from here too, wherever the reader is', async () => {
    reader.zone = 'Indian/Antananarivo';
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Corriger' }));
    const dialog = await screen.findByRole('dialog', { name: 'Corriger le rapport de Théo' });
    // 16:00 to 22:00 UTC on 26 October: 17 h – 23 h in Paris, 19 h – 1 h in Antananarivo.
    await waitFor(() => {
      expect(text(dialog.querySelector('.rp-lead__when'))).toContain('17 h – 23 h');
    });
  });

  it('opens the fold of the member asked from his record or a shift (EQ-11, EQ-13)', async () => {
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    renderPage(THEO);
    const theo = await screen.findByText('Théo', { selector: '.nv-disclosure__title' });
    const basile = screen.getByText('Basile', { selector: '.nv-disclosure__title' });
    expect(theo.closest('details')?.open).toBe(true);
    expect(basile.closest('details')?.open).toBe(false);
  });

  it('opens a refused correction again here, its member named, wherever the reader went since', async () => {
    period = [report(5, 0, { status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' })];
    rules = { currency: 'EUR', earningsSource: 'declared' };
    answer = {
      status: 409,
      body: { error: { code: 'shift_report_changed_conflict', message: 'x', details: {}, requestId: 'r' } },
    };
    const leave = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Corriger' }));
    const dialog = await screen.findByRole('dialog', { name: 'Corriger le rapport de Théo' });
    fireEvent.change(await within(dialog).findByLabelText('À ajouter ou retirer'), {
      target: { value: '-20' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer la correction' }));
    await act(leave);
    await screen.findByText('Suivi');
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(writes).toHaveLength(1);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Correction non envoyée');
    fireEvent.click(within(alert).getByRole('button', { name: 'Rouvrir' }));
    const again = await screen.findByRole('dialog', { name: 'Corriger le rapport de Théo' });
    // Typed « -20 », kept with the true minus sign the field writes (captures of #591).
    expect(within(again).getByDisplayValue('−20')).toBeTruthy();
  });
});

describe('Équipe › Rapports against the platform (ADR 0073)', () => {
  /** A complete check whose gap waits until `explainBy`: the declared amount minus what Reveal read. */
  const gapOf = (gapMinor: number, readMinor: number, explainBy: string): Record<string, unknown> => ({
    state: 'complete',
    readMinor,
    gapMinor,
    verdict: 'gap',
    explainBy,
  });

  it('keeps a gap out of the batch while its member may answer it, and lets the agency decide once explained or late (§ 5)', async () => {
    open = [
      // 110,00 € declared, 100,00 € read, until 23 h tonight in Paris: it waits for Théo.
      report(1, 0, { check: gapOf(1_000, 10_000, '2026-10-28T22:00:00.000Z') }),
      report(2, 1, {
        check: gapOf(-3_000, 15_000, '2026-10-28T22:00:00.000Z'),
        explanation: 'Un remboursement arrivé après le shift.',
      }),
      // Its 48 hours ended last night, unanswered.
      report(3, 2, { check: gapOf(1_300, 12_000, '2026-10-27T22:00:00.000Z') }),
    ];
    renderPage();
    // The gap still waiting for Théo is not the agency's yet.
    await screen.findByText('rapports attendent, dont 2 à décider maintenant');
    const [late, waits, explained] = [...document.querySelectorAll<HTMLElement>('.rp-review')];
    if (waits === undefined) throw new Error('No report waiting for its member');

    expect(text(waits)).toContain('Écart +10,00 €');
    expect(text(waits)).toContain('Reveal a lu 100,00 € pendant le shift.');
    expect(text(waits)).toContain(
      'Théo peut corriger ou expliquer l’écart jusqu’à 23 h : la validation attend.',
    );
    expect(waits.querySelector('input')?.disabled).toBe(true);
    expect(waits.getAttribute('data-locked')).toBe('true');
    // « Renvoyer » stays: the agency may still ask for the right amount.
    expect(within(waits).getByRole('button', { name: 'Renvoyer' })).toBeTruthy();

    expect(text(explained)).toContain('Écart −30,00 €');
    expect(text(explained)).toContain('Explication « Un remboursement arrivé après le shift. »');
    expect(explained?.querySelector('input')?.disabled).toBe(false);

    expect(text(late)).toContain('Délai passé sans explication : à toi de décider.');
    expect(late?.querySelector('input')?.disabled).toBe(false);

    fireEvent.click(screen.getByLabelText('Tout sélectionner'));
    expect(screen.getByRole('button', { name: 'Valider (2)' })).toBeTruthy();
  });

  it('says once when no sale of the platform is read yet: every report waits for a hand (recette EQP-05)', async () => {
    open = [report(1, 0), report(2, 1)];
    renderPage();
    expect(
      await screen.findByText(
        'Les ventes de Reveal ne sont pas encore lues : aucun rapport ne se valide tout seul, chacun se valide à la main.',
      ),
    ).toBeTruthy();
  });

  it('says what the platform read, or why nothing is compared, beside the declared amount (§ 2, § 7)', async () => {
    open = [
      report(1, 0, {
        check: { state: 'complete', readMinor: 11_000, gapMinor: 0, verdict: 'within', explainBy: null },
      }),
      report(2, 1, { check: { state: 'provisional', readMinor: 4_000 } }),
      report(3, 2, { canReview: true, check: { state: 'unavailable', reason: 'chatter_unlinked' } }),
    ];
    renderPage();
    // The matching one validates by itself: not the agency's to decide.
    await screen.findByText('rapports attendent, dont 2 à décider maintenant');
    const [unlinked, matching, provisional] = [...document.querySelectorAll('.rp-review')];
    // Some are read: the line saying none is would be wrong.
    expect(screen.queryByText(/ne sont pas encore lues/u)).toBeNull();
    expect(text(matching)).toContain('Conforme');
    expect(text(matching)).toContain(
      'Reveal a lu 110,00 € pendant le shift : le rapport se valide tout seul dans les cinq minutes.',
    );
    expect(text(provisional)).toContain(
      'Reveal a lu 40,00 € pour l’instant : la comparaison se fait un quart d’heure après la fin du shift.',
    );
    expect(text(unlinked)).toContain(
      'Ce membre n’est relié à aucun chatteur de Reveal : relie-le dans Équipe › Reveal pour comparer ses rapports.',
    );
    // Nothing the comparison cannot say holds a validation back.
    fireEvent.click(screen.getByLabelText('Tout sélectionner'));
    expect(screen.getByRole('button', { name: 'Valider (3)' })).toBeTruthy();
  });

  it('counts a member’s gaps on the period, and says a validation made by the check (§ 4, § 5)', async () => {
    period = [
      report(5, 0, {
        status: 'validated',
        reviewKind: 'automatic',
        reviewedAt: '2026-10-26T22:35:00.000Z',
        check: { state: 'complete', readMinor: 15_000, gapMinor: 0, verdict: 'within', explainBy: null },
      }),
      report(6, 2, {
        status: 'validated',
        reviewKind: 'human',
        reviewedAt: '2026-10-27T23:00:00.000Z',
        check: gapOf(1_200, 14_400, '2026-10-27T22:00:00.000Z'),
      }),
    ];
    renderPage();
    const theo = await screen.findByText('Théo', { selector: '.nv-disclosure__title' });
    const summary = theo.closest('summary');
    expect(text(summary)).toContain('1 écart');
    const lines = [...(theo.closest('details')?.querySelectorAll('.rp-pline') ?? [])].map(text);
    expect(lines.find((line) => line.includes('écart +12,00 €'))).toContain('Validé');
    expect(lines.find((line) => line.includes('150,00 €'))).toContain('Validé automatiquement');
  });
});
