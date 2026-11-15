// @vitest-environment jsdom
import { CreateLeaveRequestBodySchema, CreateShiftSwapRequestBodySchema } from '@impera/contracts';
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

import { MyPlanningPage } from './MyPlanningPage';

import { ReopenProvider } from '@/reports/reopen';
import type { MyAwayStatus } from '@/scheduling/model';
import { settingsOf } from '@/test/settings';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Indian/Antananarivo',
}));

/* An invented creator and members (ADR 0010). Antananarivo is UTC+3, the agency's Paris UTC+1 after 25/10. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NORA = id(1);
const NORA_REVEAL = id(11);
const THEO = id(21);
const BASILE = id(22);
const LOU = id(23);
const THEO_USER = id(71);
const NIGHT = id(101);
const THURSDAY = id(102);

const shift = (n: number, startsAt: string, endsAt: string, memberId = THEO): Record<string, unknown> => ({
  id: id(n),
  creatorId: NORA,
  platformAccountId: NORA_REVEAL,
  memberId,
  startsAt,
  endsAt,
  templateId: null,
  stoppedAt: null,
});

const me = {
  id: THEO,
  userId: THEO_USER,
  email: 'theo@example.test',
  firstName: 'Théo',
  lastName: 'Martin',
  displayName: 'Théo',
  teamRole: 'chatter',
  status: 'active',
  country: 'MG',
  timeZone: 'Indian/Antananarivo',
  color: '#c2410c',
  joinedOn: '2026-09-01',
  creatorIds: [NORA],
  commission: null,
  invitationPending: false,
  invitationExpiresAt: null,
};

const account = {
  id: NORA_REVEAL,
  creatorId: NORA,
  creatorName: 'Nora Vidal',
  platform: 'reveal',
  handle: 'nora',
  archived: false,
};
const people = [
  { id: THEO, displayName: 'Théo', color: '#c2410c' },
  { id: BASILE, displayName: 'Basile', color: '#0e7490' },
  { id: LOU, displayName: 'Lou', color: null },
];

const swap = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: id(401),
  requesterId: BASILE,
  shiftId: id(201),
  creatorId: NORA,
  shiftStartsAt: '2026-10-30T16:00:00Z',
  shiftEndsAt: '2026-10-30T22:00:00Z',
  targetMemberId: THEO,
  targetShiftId: null,
  targetCreatorId: null,
  targetShiftStartsAt: null,
  targetShiftEndsAt: null,
  message: 'Tu peux me remplacer ?',
  status: 'proposed',
  resolvedAt: null,
  revertedAt: null,
  withdrawnByAgency: false,
  createdAt: '2026-10-27T10:00:00Z',
  ...patch,
});

const leave = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: id(501),
  memberId: THEO,
  firstDay: '2026-11-03',
  lastDay: '2026-11-05',
  timeZone: 'Indian/Antananarivo',
  startsAt: '2026-11-02T21:00:00Z',
  endsAt: '2026-11-05T21:00:00Z',
  note: 'Examens',
  status: 'pending',
  decidedAt: null,
  cancelledAt: null,
  decisionNote: null,
  createdAt: '2026-10-27T10:00:00Z',
  ...patch,
});

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}
interface Written {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}
interface Data {
  swaps: Record<string, unknown>[];
  leaves: Record<string, unknown>[];
  candidates: unknown;
  /** The member reads that fail before one answers. */
  membersDown: number;
  /** Two shifts done earlier this week, Monday's without its report, Tuesday's validated. */
  earlier: boolean;
  /** A night shift from 22 h on Wednesday to 4 h on Thursday, at the reader's hour. */
  night: boolean;
  /** Two shifts the week before, on Tuesday 20 and Wednesday 21. */
  lastWeek: boolean;
  /** The report reads that fail before one answers. */
  reportsDown: number;
  /** Tuesday's report waits for him instead: 120,00 € declared, 108,00 € read by Reveal (ADR 0073 § 5). */
  gap: boolean;
  /** Basile's Friday shift, offered to Théo: the server's planning carries it (recette 05/11, CHAT-05). */
  offered: boolean;
  /** The zone of his record, when it is not the device's. */
  meZone: string | null;
}

const TUESDAY = id(104);
const EARLIER = [
  shift(103, '2026-10-26T06:00:00Z', '2026-10-26T12:00:00Z'),
  shift(104, '2026-10-27T06:00:00Z', '2026-10-27T12:00:00Z'),
];
const VALIDATED = {
  id: id(601),
  shiftId: TUESDAY,
  creatorId: NORA,
  platformAccountId: NORA_REVEAL,
  memberId: THEO,
  period: '2026-10-16',
  correctsId: null,
  amount: { amountMinor: 12_000, currency: 'EUR' },
  comment: null,
  incident: null,
  status: 'validated',
  version: 1,
  byAgency: false,
  reviewKind: null,
  earningsSource: 'declared',
  explanation: null,
  check: null,
  canReview: false,
  submittedAt: '2026-10-27T12:10:00Z',
  reviewedAt: '2026-10-27T15:00:00Z',
  reviewNote: null,
  createdAt: '2026-10-27T12:10:00Z',
};

const GAPPED = {
  ...VALIDATED,
  status: 'submitted',
  reviewedAt: null,
  check: {
    state: 'complete',
    readMinor: 10_800,
    gapMinor: 1_200,
    verdict: 'gap',
    explainBy: '2026-10-29T12:00:00Z',
  },
};

const weeks: string[] = [];
const calendars: string[] = [];

/** The team's calendar (CR-12): Théo's night, Basile on Wednesday morning, the agent in Automatique day and night. */
const teamCalendar = (from: string, to: string): Record<string, unknown> => ({
  view: 'team',
  settings: settingsOf(),
  creators: [{ id: NORA, name: 'Nora Vidal', archived: false }],
  members: people.slice(0, 2),
  shifts: [
    { memberId: THEO, creatorId: NORA, startsAt: '2026-10-27T22:00:00Z', endsAt: '2026-10-28T04:00:00Z' },
    { memberId: BASILE, creatorId: NORA, startsAt: '2026-10-28T07:00:00Z', endsAt: '2026-10-28T13:00:00Z' },
  ],
  agent: [
    {
      creatorId: NORA,
      timeZone: 'Europe/Paris',
      mode: 'auto',
      reply: { mode: 'always' },
      answers: [{ startsAt: from, endsAt: to }],
    },
  ],
  agency: null,
});

/** A fake `/v1/scheduling` and `/v1/team/members`: every write is kept in the list returned and answered by `write`. */
function serve(
  data: Partial<Data> = {},
  write: (method: string, path: string, body: unknown, state: Data) => Reply = () => ({ status: 500 }),
): Written[] {
  const state: Data = {
    swaps: data.swaps ?? [],
    leaves: data.leaves ?? [],
    candidates: data.candidates ?? { candidates: [], accounts: [] },
    membersDown: data.membersDown ?? 0,
    earlier: data.earlier ?? false,
    night: data.night ?? false,
    lastWeek: data.lastWeek ?? false,
    reportsDown: data.reportsDown ?? 0,
    gap: data.gap ?? false,
    offered: data.offered ?? false,
    meZone: data.meZone ?? null,
  };
  const written: Written[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = init?.method ?? 'GET';
      let reply: Reply;
      if (method !== 'GET') {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        written.push({ method, path: url.pathname, body });
        reply = write(method, url.pathname, body, state);
      } else if (url.pathname === '/v1/scheduling/planning') {
        weeks.push(url.searchParams.get('from') ?? '');
        const thisWeek = url.searchParams.get('from') === '2026-10-25T21:00:00.000Z';
        const lastWeek = state.lastWeek && url.searchParams.get('from') === '2026-10-18T21:00:00.000Z';
        // Any other range (a leave's days): the week's shifts that touch it.
        const from = url.searchParams.get('from') ?? '';
        const to = url.searchParams.get('to') ?? '';
        const touched = (one: Record<string, unknown>): boolean =>
          new Date(String(one['endsAt'])) > new Date(from) &&
          new Date(String(one['startsAt'])) < new Date(to);
        reply = {
          status: 200,
          body: {
            settings: settingsOf(),
            accounts: [account],
            members: [people[0]],
            shifts: thisWeek
              ? [
                  ...(state.earlier ? EARLIER : []),
                  shift(101, '2026-10-27T22:00:00Z', '2026-10-28T04:00:00Z'),
                  shift(102, '2026-10-29T16:00:00Z', '2026-10-29T22:00:00Z'),
                  ...(state.night ? [shift(105, '2026-10-28T19:00:00Z', '2026-10-29T01:00:00Z')] : []),
                  ...(state.offered
                    ? [shift(201, '2026-10-30T16:00:00Z', '2026-10-30T22:00:00Z', BASILE)]
                    : []),
                ]
              : lastWeek
                ? [
                    shift(106, '2026-10-20T06:00:00Z', '2026-10-20T12:00:00Z'),
                    shift(107, '2026-10-21T06:00:00Z', '2026-10-21T12:00:00Z'),
                  ]
                : [
                    shift(101, '2026-10-27T22:00:00Z', '2026-10-28T04:00:00Z'),
                    shift(102, '2026-10-29T16:00:00Z', '2026-10-29T22:00:00Z'),
                  ].filter(touched),
            conflicts: [],
            away: [],
          },
        };
      } else if (url.pathname === '/v1/scheduling/calendar') {
        calendars.push(`${url.searchParams.get('from') ?? ''}/${url.searchParams.get('to') ?? ''}`);
        reply = {
          status: 200,
          body: teamCalendar(url.searchParams.get('from') ?? '', url.searchParams.get('to') ?? ''),
        };
      } else if (url.pathname === '/v1/scheduling/shift-reports') {
        state.reportsDown -= 1;
        reply =
          state.reportsDown >= 0
            ? { status: 500 }
            : {
                status: 200,
                body: {
                  reports: state.earlier ? [state.gap ? GAPPED : VALIDATED] : [],
                  shifts: state.earlier ? EARLIER : [],
                  accounts: [account],
                  members: [people[0]],
                },
              };
      } else if (url.pathname === '/v1/team/members') {
        reply =
          state.membersDown > 0
            ? { status: 503 }
            : { status: 200, body: { members: [{ ...me, timeZone: state.meZone ?? me.timeZone }] } };
        state.membersDown -= 1;
      } else if (url.pathname === '/v1/scheduling/leave-requests')
        reply = { status: 200, body: { leaveRequests: state.leaves, members: [people[0]] } };
      else if (url.pathname === '/v1/scheduling/swap-requests')
        reply = {
          status: 200,
          body: { swapRequests: state.swaps, shifts: [], accounts: [account], members: people },
        };
      else if (url.pathname === '/v1/scheduling/swap-candidates')
        reply = { status: 200, body: state.candidates };
      else reply = { status: 404 };
      return Promise.resolve(
        new Response(reply.status === 204 ? null : JSON.stringify(reply.body ?? null), {
          status: reply.status,
        }),
      );
    }),
  );
  return written;
}

const refused = (code: string, details: Record<string, unknown> = {}): Reply => ({
  status: 409,
  body: { error: { code, message: code, details, requestId: 'r1' } },
});

/** What an element says, its no-break spaces (« 23 h », ADR 0011) read as plain ones. */
const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replaceAll('\u00a0', ' ');

function renderPage(away: MyAwayStatus | null = null): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/planning',
    component: () => <MyPlanningPage userId={THEO_USER} away={away} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/planning'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReopenProvider>
        <RouterProvider router={router} />
      </ReopenProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  weeks.length = 0;
  calendars.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the chatter’s Planning', () => {
  it('lists his week by day at his own hour, the agency’s beside it', async () => {
    serve();
    renderPage();
    const today = await screen.findByRole('region', { name: 'Aujourd’hui' });
    const night = within(today).getByRole('listitem');
    // 22:00Z is 1 h on Wednesday 28 in Antananarivo, 23 h on Tuesday in Paris.
    expect(text(night)).toContain('1 h – 7 h');
    expect(text(night)).toContain('@nora sur Reveal · 23 h – 5 h à Paris');
    expect(text(night)).toContain('En poste');
    // A shift ahead carries no pill: the day and its place say it (EQ-18).
    // A shift under way is not offered to anyone; one ahead is.
    expect(within(night).queryByRole('button', { name: /^Échanger/u })).toBe(null);
    const thursday = screen.getByRole('region', { name: 'Jeudi 29 octobre' });
    expect(text(thursday)).toContain('19 h – 1 h');
    expect(text(thursday)).not.toContain('À venir');
    expect(within(thursday).getByRole('button', { name: /^Échanger/u })).toBeTruthy();
    expect(screen.getByText('2 shifts · 12 h')).toBeTruthy();
  });

  it('keeps a colleague’s shift offered to him out of his shifts and their total (CHAT-05)', async () => {
    serve({ offered: true, swaps: [swap({})] });
    renderPage();
    expect(await screen.findByText('2 shifts · 12 h')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Vendredi 30 octobre' })).toBe(null);
    // The proposal waits in the exchanges, where it is answered.
    expect(await screen.findByText('Tu peux me remplacer ?', { exact: false })).toBeTruthy();
  });

  it('speaks the hour of his record, not of the device, on the page as in the leave (CHAT-11)', async () => {
    serve({ meZone: 'Africa/Porto-Novo' });
    renderPage();
    await screen.findByText('Tes shifts, à ton heure (Porto-Novo).');
    const ask = screen.getByRole('button', { name: 'Demander un congé' });
    await waitFor(() => {
      expect(ask.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(ask);
    const panel = await screen.findByRole('dialog', { name: 'Demander un congé' });
    expect(text(panel)).toContain('à ton heure (Porto-Novo)');
  });

  it('opens on today, folds the days gone by with the reports left, and makes a report from its shift', async () => {
    serve({ earlier: true });
    renderPage();
    await screen.findByRole('region', { name: 'Aujourd’hui' });
    const fold = await screen.findByText('Plus tôt cette semaine (2)');
    const details = fold.closest('details');
    expect(details?.open).toBe(false);
    await waitFor(() => {
      expect(text(details?.querySelector('summary'))).toContain('1 rapport à faire');
    });
    // Today comes before nothing: the folded days sit above it, out of the way.
    expect(details?.compareDocumentPosition(screen.getByRole('region', { name: 'Aujourd’hui' }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const monday = within(details ?? document.body).getByRole('region', { name: 'Lundi 26 octobre' });
    const tuesday = within(details ?? document.body).getByRole('region', { name: 'Mardi 27 octobre' });
    expect(text(tuesday)).not.toContain('Fini');
    expect(within(tuesday).getByRole('button', { name: /Rapport du .* : Validé/u }).textContent).toBe(
      'Rapport validé',
    );
    fireEvent.click(within(monday).getByRole('button', { name: /^Faire mon rapport du lundi 26 octobre/u }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('says in amber a report whose gap with Reveal waits for him (ADR 0073 § 5)', async () => {
    serve({ earlier: true, gap: true });
    renderPage();
    const fold = await screen.findByText('Plus tôt cette semaine (2)');
    await waitFor(() => {
      expect(text(fold.closest('summary'))).toContain('1 rapport à faire · 1 écart à expliquer');
    });
    const tuesday = within(fold.closest('details') ?? document.body).getByRole('region', {
      name: 'Mardi 27 octobre',
    });
    const chip = await within(tuesday).findByRole('button', { name: /Rapport du .* : écart à expliquer/u });
    expect(chip.textContent).toBe('Écart · À expliquer');
    expect(chip.className).toContain('rp-chip--warn');
  });

  it('keeps a night shift begun yesterday out of the fold while it is under way', async () => {
    // 23:00Z is 2 h on Thursday 29 in Antananarivo: Wednesday's night shift, begun at 22 h, runs until 4 h.
    vi.setSystemTime(new Date('2026-10-28T23:00:00Z'));
    serve({ earlier: true, night: true });
    renderPage();
    await screen.findByRole('region', { name: 'Aujourd’hui' });
    const details = (await screen.findByText('Plus tôt cette semaine (2)')).closest('details');
    const wednesday = screen.getByRole('region', { name: 'Mercredi 28 octobre' });
    expect(details?.contains(wednesday)).toBe(false);
    expect(text(wednesday)).toContain('22 h – 4 h');
    expect(text(wednesday)).toContain('En poste');
  });

  it('says first that he is suspended, and no shift of his reads « En poste » (CHAT-09)', async () => {
    vi.setSystemTime(new Date('2026-10-28T23:00:00Z'));
    serve({ earlier: true, night: true });
    renderPage('suspended');
    const card = (await screen.findByRole('heading', { name: 'Ton accès est suspendu' })).closest('section');
    expect(card?.textContent).toContain('Parle à ton responsable.');
    const wednesday = await screen.findByRole('region', { name: 'Mercredi 28 octobre' });
    expect(text(wednesday)).toContain('22 h – 4 h');
    expect(text(wednesday)).not.toContain('En poste');
  });

  it('keeps a week gone by in its order, with no fold', async () => {
    serve({ lastWeek: true });
    renderPage();
    await screen.findByText('2 shifts · 12 h');
    fireEvent.click(screen.getByRole('button', { name: 'Semaine précédente' }));
    expect(await screen.findByRole('region', { name: 'Mardi 20 octobre' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Mercredi 21 octobre' })).toBeTruthy();
    expect(screen.queryByText(/^Plus tôt cette semaine/u)).toBe(null);
  });

  it('says when the reports cannot be read, and reads them again', async () => {
    // The first read and its one retry fail; « Réessayer » reads them.
    serve({ earlier: true, reportsDown: 2 });
    renderPage();
    const alert = await screen.findByText('Tes rapports n’ont pas pu être lus.', {}, { timeout: 3000 });
    fireEvent.click(within(alert.parentElement ?? document.body).getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => {
      expect(screen.queryByText('Tes rapports n’ont pas pu être lus.')).toBe(null);
    });
    const fold = screen.getByText('Plus tôt cette semaine (2)').closest('summary');
    await waitFor(() => {
      expect(text(fold)).toContain('1 rapport à faire');
    });
  });

  it('turns to the next week, says when it is empty, and comes back', async () => {
    serve();
    renderPage();
    await screen.findByText('2 shifts · 12 h');
    fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
    expect(await screen.findByRole('heading', { name: 'Aucun shift cette semaine' })).toBeTruthy();
    expect(weeks.at(-1)).toBe('2026-11-01T21:00:00.000Z');
    fireEvent.click(screen.getByRole('button', { name: 'Cette semaine' }));
    expect(await screen.findByText('2 shifts · 12 h')).toBeTruthy();
  });

  it('answers a colleague’s proposal, and says plainly when it no longer holds (ADR 0031)', async () => {
    const written = serve({ swaps: [swap({})] }, (_method, _path, _body, state) => {
      // The quarter-hour job had not passed yet: the server lapses it now, the next read says so.
      state.swaps = [swap({ status: 'lapsed', resolvedAt: '2026-10-28T00:00:00Z' })];
      return refused('shift_swap_lapsed_conflict');
    });
    renderPage();
    const asks = await screen.findByRole('region', { name: 'Un échange attend ta réponse' });
    expect(text(asks)).toContain('Basile te propose son shift');
    expect(text(asks)).toContain('Tu prendrais');
    expect(text(asks)).toContain('ven. 30 oct. · 19 h – 1 h · Nora Vidal');
    expect(text(asks)).toContain('Tu peux me remplacer ?');
    fireEvent.click(within(asks).getByRole('button', { name: 'Accepter' }));
    expect(text(await screen.findByRole('status'))).toContain(
      'Cet échange ne tient plus : un des shifts a commencé, a été annulé ou a changé de mains.',
    );
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Accepter' })).toBe(null);
    });
    expect(screen.queryByRole('alert')).toBe(null);
    expect(written).toEqual([
      { method: 'POST', path: `/v1/scheduling/swap-requests/${id(401)}/answer`, body: { answer: 'accept' } },
    ]);
  });

  it('says an exchange done, and blames neither member when it cannot be', async () => {
    const exchange = swap({
      targetShiftId: id(202),
      targetCreatorId: NORA,
      targetShiftStartsAt: '2026-10-31T10:00:00Z',
      targetShiftEndsAt: '2026-10-31T16:00:00Z',
    });
    let tries = 0;
    serve({ swaps: [exchange] }, (_method, _path, _body, state) => {
      tries += 1;
      // The first time, Basile has since taken a shift that overlaps Théo's: the server names it, the page does not.
      if (tries === 1) return refused('shift_member_conflict', { shiftId: id(203) });
      const accepted = { ...exchange, status: 'accepted', resolvedAt: '2026-10-28T00:00:00Z' };
      state.swaps = [accepted];
      return { status: 200, body: accepted };
    });
    renderPage();
    const asks = await screen.findByRole('region', { name: 'Un échange attend ta réponse' });
    fireEvent.click(within(asks).getByRole('button', { name: 'Accepter' }));
    expect(text(await within(asks).findByRole('alert'))).toBe(
      'L’un de vous deux est déjà sur un autre shift à ces heures : l’échange ne peut pas se faire.',
    );
    fireEvent.click(within(asks).getByRole('button', { name: 'Accepter' }));
    expect(text(await screen.findByRole('status'))).toContain('C’est fait : vous avez échangé vos shifts.');
    // Answered, it is told in the past among his swaps, with Basile's word kept.
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Un échange attend ta réponse' })).toBe(null);
    });
    const swaps = screen.getByText('Mes échanges').closest('details');
    expect(text(swaps)).toContain('Tu as accepté');
    expect(text(swaps)).toContain('Tu as pris');
    expect(text(swaps)).toContain('Tu lui as donné');
    expect(text(swaps)).toContain('Tu peux me remplacer ?');
  });

  it('offers a shift ahead to a colleague free then, never to one busy elsewhere', async () => {
    const written = serve(
      {
        candidates: {
          candidates: [
            { member: people[1], freeThen: true, shifts: [] },
            { member: people[2], freeThen: false, shifts: [] },
          ],
          accounts: [account],
        },
      },
      (_method, _path, body) => ({
        status: 201,
        body: swap({ ...(typeof body === 'object' ? body : {}), requesterId: THEO, targetMemberId: BASILE }),
      }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Échanger ton shift du jeudi 29 octobre/u }));
    const panel = await screen.findByRole('dialog', { name: 'Proposer un échange' });
    expect(text(panel)).toContain('Ton shift du jeu. 29 oct. · 19 h – 1 h · Nora Vidal.');
    const lou = await within(panel).findByRole('radio', { name: /^Lou/u });
    // Busy on a shift Théo cannot see, with nothing to give back for it: Lou cannot take it.
    expect(text(lou)).toContain('Déjà en shift à ces heures');
    expect(lou.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(panel).getByRole('radio', { name: /^Basile/u }));
    expect(
      within(panel)
        .getByRole('radio', { name: /^Rien, je donne mon shift/u })
        .getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.change(within(panel).getByLabelText(/Un mot pour Basile/u), {
      target: { value: 'Tu peux me remplacer ?' },
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Proposer à Basile' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBe(null);
    });
    expect(written.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /v1/scheduling/swap-requests',
    ]);
    // Its id is made when the panel opens: a retry records one proposal.
    const { id: proposalId, ...proposal } = CreateShiftSwapRequestBodySchema.parse(written[0]?.body);
    expect(proposalId).not.toBe('');
    expect(proposal).toEqual({
      shiftId: THURSDAY,
      targetMemberId: BASILE,
      targetShiftId: null,
      message: 'Tu peux me remplacer ?',
    });
  });

  it('lets a busy colleague take a shift only against theirs, and words a refusal without their shift', async () => {
    const theirs = shift(301, '2026-10-29T17:00:00Z', '2026-10-29T23:00:00Z', LOU);
    const written = serve(
      {
        candidates: {
          candidates: [{ member: people[2], freeThen: false, shifts: [theirs] }],
          accounts: [account],
        },
      },
      () => refused('shift_member_conflict', { shiftId: NIGHT }),
    );
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Échanger ton shift du jeudi 29 octobre/u }));
    const panel = await screen.findByRole('dialog', { name: 'Proposer un échange' });
    fireEvent.click(await within(panel).findByRole('radio', { name: /^Lou.*seulement contre celui-là/u }));
    expect(within(panel).queryByRole('radio', { name: /^Rien/u })).toBe(null);
    const back = within(panel).getByRole('radio', { name: /^jeu\. 29 oct\. · 20\sh – 2\sh/u });
    expect(back.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Proposer à Lou' }));
    expect(text(await within(panel).findByRole('alert'))).toBe(
      'Le shift rendu tombe sur un autre de tes shifts.',
    );
    expect(written.map(({ body }) => CreateShiftSwapRequestBodySchema.parse(body).targetShiftId)).toEqual([
      id(301),
    ]);
  });

  it('never offers a colleague busy on two shifts then: no exchange could hold', async () => {
    serve({
      candidates: {
        candidates: [
          {
            member: people[2],
            freeThen: false,
            shifts: [
              shift(301, '2026-10-29T11:00:00Z', '2026-10-29T17:00:00Z', LOU),
              shift(302, '2026-10-29T17:00:00Z', '2026-10-29T23:00:00Z', LOU),
            ],
          },
        ],
        accounts: [account],
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Échanger ton shift du jeudi 29 octobre/u }));
    const panel = await screen.findByRole('dialog', { name: 'Proposer un échange' });
    const lou = await within(panel).findByRole('radio', { name: /^Lou/u });
    expect(text(lou)).toContain('Déjà en shift à ces heures');
    expect(text(lou)).not.toContain('seulement contre celui-là');
    expect(lou.hasAttribute('disabled')).toBe(true);
  });

  it('says why a leave cannot be asked yet when his record does not come, and tries again', async () => {
    // The first read and its one retry fail (EQ-22).
    serve({ membersDown: 2 });
    renderPage();
    const warning = await screen.findByRole('alert', {}, { timeout: 4_000 });
    expect(text(warning)).toContain('Le serveur ne répond pas : ta fiche n’a pas pu être lue');
    // « Mes congés », where a leave is asked, waits for his record.
    expect(screen.queryByRole('button', { name: 'Demander un congé' })).toBe(null);
    fireEvent.click(within(warning).getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('button', { name: 'Demander un congé' })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.queryByRole('alert')).toBe(null);
  });

  it('asks for a leave in whole days of his own zone', async () => {
    const written = serve({}, (_method, _path, body) => ({
      status: 201,
      body: leave(typeof body === 'object' ? { ...body } : {}),
    }));
    renderPage();
    await screen.findByText('2 shifts · 12 h');
    fireEvent.click(await screen.findByRole('button', { name: 'Demander un congé' }));
    const panel = await screen.findByRole('dialog', { name: 'Demander un congé' });
    expect(text(panel)).toContain('à ton heure (Antananarivo)');
    fireEvent.change(within(panel).getByLabelText('Premier jour'), { target: { value: '2026-11-03' } });
    // The last day follows a first day moved past it.
    expect(within(panel).getByLabelText('Dernier jour')).toHaveProperty('value', '03/11/2026');
    fireEvent.change(within(panel).getByLabelText('Dernier jour'), { target: { value: '2026-11-05' } });
    expect(text(panel)).toContain('Du mar. 3 nov. au jeu. 5 nov., 3 jours.');
    fireEvent.change(within(panel).getByLabelText('Dernier jour'), { target: { value: '2026-12-10' } });
    expect(text(panel)).toContain('Un congé dure 31 jours au plus');
    expect(within(panel).getByRole('button', { name: 'Envoyer la demande' }).hasAttribute('disabled')).toBe(
      true,
    );
    fireEvent.change(within(panel).getByLabelText('Dernier jour'), { target: { value: '2026-11-05' } });
    fireEvent.change(within(panel).getByLabelText(/Un mot pour l’agence/u), { target: { value: 'Examens' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Envoyer la demande' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBe(null);
    });
    expect(written.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /v1/scheduling/leave-requests',
    ]);
    const { id: requestId, ...request } = CreateLeaveRequestBodySchema.parse(written[0]?.body);
    expect(requestId).not.toBe('');
    expect(request).toEqual({ firstDay: '2026-11-03', lastDay: '2026-11-05', note: 'Examens' });
  });

  it('says his shift on the days of a leave in amber, and offers it from there (CHAT-28)', async () => {
    serve();
    renderPage();
    await screen.findByText('2 shifts · 12 h');
    const ask = screen.getByRole('button', { name: 'Demander un congé' });
    await waitFor(() => {
      expect(ask.hasAttribute('disabled')).toBe(false);
    });
    fireEvent.click(ask);
    const panel = await screen.findByRole('dialog', { name: 'Demander un congé' });
    fireEvent.change(within(panel).getByLabelText('Premier jour'), { target: { value: '29/10/2026' } });
    const clash = await within(panel).findByText(
      'Tu as un shift ces jours-là : propose-le d’abord en échange.',
    );
    const warning = clash.parentElement;
    expect(text(warning)).toContain('29 oct. · 19 h – 1 h · Nora Vidal');
    if (warning === null) throw new Error('no warning');
    fireEvent.click(within(warning).getByRole('button', { name: 'Échanger' }));
    expect(await screen.findByRole('dialog', { name: 'Proposer un échange' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Demander un congé' })).toBe(null);
  });

  // Relecture d'Équipe (#569): « 3/1 » on its way to « 3/11 » is the 3rd of January; the last day kept it.
  it('keeps the last day on the first while the first is typed digit by digit', async () => {
    serve({});
    renderPage();
    await screen.findByText('2 shifts · 12 h');
    fireEvent.click(await screen.findByRole('button', { name: 'Demander un congé' }));
    const panel = await screen.findByRole('dialog', { name: 'Demander un congé' });
    const first = within(panel).getByLabelText('Premier jour');
    for (const typed of ['3', '3/', '3/1', '3/11']) fireEvent.change(first, { target: { value: typed } });
    expect(within(panel).getByLabelText('Dernier jour')).toHaveProperty('value', '03/11/2026');
    expect(text(panel)).toContain('Le mar. 3 nov., 1 jour.');
    // A last day typed itself stays where it was put; a first day past it is said, not followed.
    fireEvent.change(within(panel).getByLabelText('Dernier jour'), { target: { value: '5/11' } });
    fireEvent.blur(within(panel).getByLabelText('Dernier jour'));
    for (const typed of ['1', '1/', '1/1', '1/11']) fireEvent.change(first, { target: { value: typed } });
    expect(within(panel).getByLabelText('Dernier jour')).toHaveProperty('value', '05/11/2026');
    expect(text(panel)).toContain('Du dim. 1er nov. au jeu. 5 nov., 5 jours.');
  });

  // Relecture des captures (#575): « 31/02 » was told how a day is written, under both fields.
  it('says under the last day itself that a day does not exist, once it is left', async () => {
    serve({});
    renderPage();
    await screen.findByText('2 shifts · 12 h');
    fireEvent.click(await screen.findByRole('button', { name: 'Demander un congé' }));
    const panel = await screen.findByRole('dialog', { name: 'Demander un congé' });
    const last = within(panel).getByLabelText('Dernier jour');
    fireEvent.focus(last);
    fireEvent.change(last, { target: { value: '31/02' } });
    expect(within(panel).queryByText('Ce jour n’existe pas.')).toBeNull();
    fireEvent.blur(last);
    const said = within(panel).getByText('Ce jour n’existe pas.');
    expect(said.parentElement).toBe(last.parentElement);
    expect(last.getAttribute('aria-describedby')).toBe(said.id);
    fireEvent.focus(last);
    fireEvent.change(last, { target: { value: 'jeudi' } });
    fireEvent.blur(last);
    expect(within(panel).getByText('Un jour comme 28/03/2027, ou 28/3.').parentElement).toBe(
      last.parentElement,
    );
    expect(within(panel).getByRole('button', { name: 'Envoyer la demande' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the leave of the week, and folds his leaves and swaps with a pending request to withdraw', async () => {
    const written = serve(
      {
        leaves: [
          leave({
            id: id(502),
            firstDay: '2026-10-30',
            lastDay: '2026-10-30',
            status: 'approved',
            note: null,
          }),
          leave({}),
        ],
        swaps: [
          swap({
            id: id(402),
            requesterId: THEO,
            targetMemberId: BASILE,
            status: 'withdrawn',
            withdrawnByAgency: true,
            resolvedAt: '2026-10-27T12:00:00Z',
          }),
        ],
      },
      () => ({ status: 204 }),
    );
    renderPage();
    expect(text((await screen.findByText('En congé')).parentElement)).toContain('Le ven. 30 oct.');
    const leaves = screen.getByText('Mes congés').closest('details');
    expect(text(leaves)).toContain('1 en attente · 1 validé');
    const swaps = screen.getByText('Mes échanges').closest('details');
    expect(text(swaps)).toContain('Ton shift pour Basile');
    expect(text(swaps)).toContain('Retiré par l’agence');
    if (leaves === null) throw new Error('no leaves');
    fireEvent.click(within(leaves).getByRole('button', { name: 'Retirer' }));
    await waitFor(() => {
      expect(written).toEqual([
        { method: 'DELETE', path: `/v1/scheduling/leave-requests/${id(501)}`, body: null },
      ]);
    });
  });
});

describe('the team’s calendar on the chatter’s Planning (CR-12)', () => {
  it('shows every créneau of the week at the agency’s hour, who holds it and the agent, in words', async () => {
    serve();
    renderPage();
    await screen.findByRole('region', { name: 'Aujourd’hui' });
    fireEvent.click(screen.getByRole('radio', { name: 'L’équipe' }));
    const grid = await screen.findByRole('table', { name: /^Planning de l’équipe/u });
    expect(calendars[0]).toBe('2026-10-25T23:00:00.000Z/2026-11-01T23:00:00.000Z');
    expect(text(screen.getByText(/^Qui chatte quand dans l’équipe/u))).toContain('Paris');
    const row = within(grid).getByRole('row', { name: /Nora Vidal/u });
    expect(text(row)).toContain('IA automatique · jour et nuit');
    // His own shift reads « Toi », at the agency's hour, under way with what is left of it; a shift across two
    // créneaux is drawn on both, its hours kept, after « … » on the second (ADR 0049 § 1).
    expect(text(row)).toContain('Toi, 23 h – 5 h, en poste, reste 4 h ; l’IA en automatique');
    expect(text(row)).toContain('Toi… 23 h – 5 hreste 4 h');
    // Wednesday's first créneau reads it again, not as a copy: a phone shows that day alone, and its edge breathes.
    const live = [...row.querySelectorAll('.cal-chip[data-phase="live"]')];
    expect(live.map((chip) => chip.getAttribute('data-carried'))).toEqual([null, null]);
    expect(within(row).getAllByText('Basile')).toHaveLength(2);
    // Across two créneaux of one day, it is read once: the second only says it goes on, greyed (CHAT-15).
    expect(text(row)).not.toContain('Basile… 8 h – 14 h');
    const cont = row.querySelector('.cal-chip--cont');
    expect(text(cont)).toBe('Basilesuite');
    expect(cont?.getAttribute('data-carried')).toBe('true');
    // Nobody but the agent, in Automatique: « IA seule », said in words too.
    expect(text(row)).toContain('18 h – 0 h, l’IA seule');
    expect(within(row).getAllByText('IA seule').length).toBeGreaterThan(0);
    // A chatter reads an empty créneau ahead « Libre », in the legend too.
    expect(document.querySelector('.cal-legend__keys')?.textContent).toContain('Libre');
    // « Mes congés » and « Mes échanges » under it, as wide as the calendar.
    expect(document.querySelector('.sc-folds')?.getAttribute('data-wide')).toBe('true');
  });

  it('reads six weeks for the month, and opens a day touched in detail', async () => {
    serve();
    renderPage();
    await screen.findByRole('region', { name: 'Aujourd’hui' });
    fireEvent.click(screen.getByRole('radio', { name: 'L’équipe' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Mois' }));
    const month = await screen.findByRole('table', { name: 'Planning de l’équipe, octobre 2026' });
    // From Monday 28 September, 42 days of 24 h: the hour the change of time adds is cut back.
    expect(calendars.at(-1)).toBe('2026-09-27T22:00:00.000Z/2026-11-08T22:00:00.000Z');
    expect(text(screen.getByText(/^Toi :/u))).toBe('Toi : 6 h en octobre');
    const wednesday = within(month).getByRole('button', { name: /^mercredi 28 octobre/u });
    // Théo's night runs on into Wednesday: two shifts that day, one his.
    expect(wednesday.getAttribute('aria-label')).toBe(
      'mercredi 28 octobre : 2 shifts, dont le tien, l’IA seule sur 1 créneau',
    );
    const tuesday = within(month).getByRole('button', { name: /^mardi 27 octobre/u });
    expect(tuesday.getAttribute('aria-label')).toContain('ton shift');
    expect(within(month).getAllByRole('cell')).toHaveLength(42);
    fireEvent.click(wednesday);
    expect(wednesday.getAttribute('aria-pressed')).toBe('true');
    const detail = screen.getByRole('region', { name: 'mercredi 28 octobre' });
    expect(text(detail)).toContain('Basile, 8 h – 14 h ; l’IA en automatique');
    expect(text(detail)).toContain('l’IA seule');
  });

  it('brings a member’s shifts forward from the legend', async () => {
    serve();
    renderPage();
    await screen.findByRole('region', { name: 'Aujourd’hui' });
    fireEvent.click(screen.getByRole('radio', { name: 'L’équipe' }));
    await screen.findByRole('table', { name: /^Planning de l’équipe/u });
    const basile = screen.getByRole('button', { name: 'Basile' });
    fireEvent.click(basile);
    expect(basile.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('.cal-chip[data-muted="true"]').length).toBeGreaterThan(0);
  });
});
