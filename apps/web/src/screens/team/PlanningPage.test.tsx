// @vitest-environment jsdom
import { TeamMemberSchema, type TeamMember } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanningPage } from './PlanningPage';
import { parsePlanningSearch } from './model';

const reader = vi.hoisted(() => ({ zone: 'Europe/Paris' }));
vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => reader.zone,
}));

/* Invented creators and members: no real data (ADR 0010). Paris is UTC+1 after 25/10: 22:00Z is 23 h. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const NORA = id(1);
const NORA_REVEAL = id(11);
const THEO = id(21);
const NIGHT = id(101);
const TEMPLATE = id(31);
const NOW = new Date('2026-10-28T00:00:00Z');
const OWNER_USER = id(70);
const BASILE = id(22);
const LEAVE = id(41);

const member = (patch: Record<string, unknown>): TeamMember =>
  TeamMemberSchema.parse({
    id: THEO,
    userId: id(71),
    email: 'membre@example.test',
    firstName: 'Théo',
    lastName: 'Martin',
    displayName: 'Théo',
    teamRole: 'chatter',
    status: 'active',
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    color: '#c2410c',
    joinedOn: '2026-09-01',
    creatorIds: [NORA],
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
    ...patch,
  });

const night = {
  id: NIGHT,
  creatorId: NORA,
  platformAccountId: NORA_REVEAL,
  memberId: THEO,
  startsAt: '2026-10-27T22:00:00Z',
  endsAt: '2026-10-28T04:00:00Z',
  templateId: TEMPLATE,
  stoppedAt: null,
};

const ACCOUNTS = [
  { id: NORA_REVEAL, creatorId: NORA, creatorName: 'Nora Vidal', platform: 'reveal', handle: 'nora' },
];

const planning = (
  conflicts: unknown[] = [],
  shifts: unknown[] = [night],
  accounts: unknown[] = ACCOUNTS,
): unknown => ({
  settings: { timeZone: 'Europe/Paris', slotStartMinute: 0, slotLengthMinutes: 360, accessMarginMinutes: 15 },
  accounts,
  members: [{ id: THEO, displayName: 'Théo', color: '#c2410c' }],
  shifts,
  conflicts,
});

const template = {
  id: TEMPLATE,
  creatorId: NORA,
  platformAccountId: NORA_REVEAL,
  memberId: THEO,
  weekday: 2,
  startMinute: 1380,
  endMinute: 300,
  validFrom: '2026-10-20',
  validUntil: null,
};

const leave = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: LEAVE,
  memberId: THEO,
  firstDay: '2026-10-29',
  lastDay: '2026-10-30',
  timeZone: 'Africa/Porto-Novo',
  startsAt: '2026-10-28T23:00:00Z',
  endsAt: '2026-10-30T23:00:00Z',
  note: 'Examens',
  status: 'pending',
  decidedAt: null,
  cancelledAt: null,
  decisionNote: null,
  createdAt: '2026-10-27T10:00:00Z',
  ...patch,
});

const swap = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: id(61),
  requesterId: THEO,
  shiftId: id(102),
  creatorId: NORA,
  shiftStartsAt: '2026-10-29T22:00:00Z',
  shiftEndsAt: '2026-10-30T04:00:00Z',
  targetMemberId: BASILE,
  targetShiftId: null,
  targetCreatorId: null,
  targetShiftStartsAt: null,
  targetShiftEndsAt: null,
  message: null,
  status: 'proposed',
  resolvedAt: null,
  revertedAt: null,
  withdrawnByAgency: false,
  createdAt: '2026-10-27T10:00:00Z',
  ...patch,
});

/** Text as read: no-break spaces (« 23 h ») as plain ones. */
const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replaceAll('\u00a0', ' ');

/** « N congés à valider », folded above the grid (EQ-02): opened, as the owner would. */
async function decideFold(): Promise<HTMLElement> {
  const title = await screen.findByText(/^\d+ congés? à valider$/u);
  const fold = title.closest('details');
  if (fold === null) throw new Error('no fold of the leaves to decide');
  fireEvent.click(title);
  return fold;
}

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}
interface Written {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

/** A fake `/v1/scheduling` and `/v1/team/members`: every write is kept in the list returned and answered by `write`. */
function serve(
  routes: {
    /** The planning read, or what it answers for a range that starts at `from`. */
    planning?: unknown;
    planningOf?: (from: string) => unknown;
    members?: TeamMember[];
    leaves?: unknown[];
    swaps?: unknown[];
    /** The reports of every period asked. */
    reports?: unknown[];
    write?: (method: string, path: string, body: unknown) => Reply;
  } = {},
): Written[] {
  const written: Written[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const path = url.pathname;
      const method = init?.method ?? 'GET';
      let reply: Reply;
      if (method !== 'GET') {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        written.push({ method, path, body });
        reply = routes.write?.(method, path, body) ?? { status: 500 };
      } else if (path === '/v1/scheduling/planning')
        reply = {
          status: 200,
          body: routes.planningOf?.(url.searchParams.get('from') ?? '') ?? routes.planning ?? planning(),
        };
      else if (path === '/v1/scheduling/shift-templates')
        reply = { status: 200, body: { templates: [template] } };
      else if (path === '/v1/scheduling/on-duty')
        reply = {
          status: 200,
          body: {
            onDuty: [
              {
                creatorId: NORA,
                platformAccountId: NORA_REVEAL,
                member: { id: THEO, displayName: 'Théo', color: '#c2410c' },
                shiftId: NIGHT,
                endsAt: night.endsAt,
              },
            ],
          },
        };
      else if (path === '/v1/team/members')
        reply = { status: 200, body: { members: routes.members ?? [member({})] } };
      else if (path === '/v1/scheduling/leave-requests')
        reply = {
          status: 200,
          body: {
            leaveRequests: routes.leaves ?? [],
            members: [{ id: THEO, displayName: 'Théo', color: '#c2410c' }],
          },
        };
      else if (path === '/v1/scheduling/swap-requests')
        reply = {
          status: 200,
          body: {
            swapRequests: routes.swaps ?? [],
            shifts: [],
            accounts: ACCOUNTS,
            members: [
              { id: THEO, displayName: 'Théo', color: '#c2410c' },
              { id: BASILE, displayName: 'Basile', color: null },
            ],
          },
        };
      else if (path === '/v1/scheduling/shift-reports')
        reply = {
          status: 200,
          body: { reports: routes.reports ?? [], shifts: [], accounts: [], members: [] },
        };
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

function renderPage(at = '/equipe/planning'): AnyRouter {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/equipe/planning',
    validateSearch: parsePlanningSearch,
    component: function Page() {
      const { semaine, membre } = page.useSearch();
      const navigate = page.useNavigate();
      return (
        <PlanningPage
          userId={OWNER_USER}
          week={semaine ?? null}
          member={membre ?? null}
          onWeek={(monday) =>
            void navigate({ search: (before) => ({ ...before, semaine: monday ?? undefined }) })
          }
          onMember={(id) => void navigate({ search: (before) => ({ ...before, membre: id ?? undefined }) })}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  // Équipe's tabs watch their own width.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  reader.zone = 'Europe/Paris';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Équipe › Planning', () => {
  it('lays the week out by account and day, with who is on shift now', async () => {
    serve();
    renderPage();
    // The first render of the file (router, queries) can outlast the default second on a loaded CI runner.
    const chip = await screen.findByRole(
      'button',
      { name: 'Théo, 23 h – 5 h, jusqu’au lendemain, en poste' },
      { timeout: 4_000 },
    );
    // The night shift starts on Tuesday 27, at the agency's hour.
    const row = screen.getByRole('row', { name: /Nora Vidal/u });
    expect(within(row).getByRole('rowheader').textContent).toContain('Nora Vidal@nora sur Reveal');
    expect(within(row).getAllByRole('cell')[1]?.contains(chip)).toBe(true);
    const duty = screen.getByRole('region', { name: 'En poste maintenant' });
    expect(duty.textContent).toContain('ThéoNora Vidaljusqu’à 5 h');
    expect(screen.getByText('1 shift · 6 h')).toBeTruthy();
  });

  it('lines the agency’s créneaux up and says an empty one ahead « À pourvoir » (EQ-01)', async () => {
    serve();
    renderPage();
    const row = await screen.findByRole('row', { name: /Nora Vidal/u }, { timeout: 4_000 });
    // Wednesday 28, 1 h in Paris: Théo's night ends at 5 h, so Wednesday's night is left to fill from 5 h to 6 h;
    // 4 + 4 × 4 are ahead.
    expect(text(document.querySelector('.sc-grid__corner'))).toBe('1 shift · 6 h · 20 créneaux à pourvoir');
    const cells = within(row).getAllByRole('cell');
    const fills = (index: number): HTMLElement[] =>
      within(cells[index] ?? row).queryAllByRole('button', { name: /^À pourvoir/u });
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => fills(index).length)).toEqual([0, 0, 4, 4, 4, 4, 4]);
    // A créneau covered in part says the part with nobody (Équipe's review of #317).
    expect(fills(2)[0]?.getAttribute('aria-label')).toMatch(/^À pourvoir : 5\sh – 6\sh, le mercredi 28/u);
    // A créneau gone by with nobody is grey, with nothing to press.
    expect(cells[0]?.querySelectorAll('.sc-slot__gone')).toHaveLength(4);
    // Every day holds its four créneaux in the same order, the shift in the evening one.
    expect(cells[1]?.querySelectorAll('.sc-slot')[3]?.textContent).toContain('Théo');
    fireEvent.click(
      within(cells[3] ?? row).getByRole('button', { name: /^À pourvoir : 6\sh – 12\sh, le jeudi 29/u }),
    );
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    expect(
      within(panel)
        .getByRole('radio', { name: /^6\sh – 12\sh$/u })
        .getAttribute('aria-checked'),
    ).toBe('true');
    const day = within(panel).getByLabelText('Jour');
    if (!(day instanceof HTMLInputElement)) throw new Error('no day field');
    expect(day.value).toBe('2026-10-29');
  });

  it('stacks the shifts at another hour than the agency’s: its créneaux would not line up', async () => {
    reader.zone = 'Indian/Antananarivo';
    serve();
    renderPage();
    await screen.findByRole('button', { name: /^Théo, 23\u00a0h – 5\u00a0h/u });
    expect(screen.getAllByRole('button', { name: /^À pourvoir/u }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('radio', { name: 'Mon heure (Antananarivo)' }));
    await screen.findByRole('button', { name: /^Théo, 1\u00a0h – 7\u00a0h/u });
    expect(screen.queryAllByRole('button', { name: /^À pourvoir/u })).toEqual([]);
  });

  it('says the marks of a shift under the grid (EQ-24)', async () => {
    serve();
    renderPage();
    await screen.findByRole('row', { name: /Nora Vidal/u }, { timeout: 4_000 });
    expect(text(document.querySelector('.sc-legend'))).toBe('Revient chaque semaine');
  });

  it('reads the week at the reader’s own hour on demand', async () => {
    reader.zone = 'Indian/Antananarivo';
    serve();
    renderPage();
    await screen.findByRole('button', { name: /^Théo, 23\u00a0h – 5\u00a0h/u });
    fireEvent.click(screen.getByRole('radio', { name: 'Mon heure (Antananarivo)' }));
    expect(await screen.findByRole('button', { name: /^Théo, 1\u00a0h – 7\u00a0h/u })).toBeTruthy();
  });

  it('says in amber which weekly shifts could not be placed, and opens the one in the way', async () => {
    serve({
      planning: planning([
        {
          templateId: TEMPLATE,
          startsAt: '2026-10-29T22:00:00Z',
          endsAt: '2026-10-30T04:00:00Z',
          reason: 'member_busy',
          shiftId: NIGHT,
        },
      ]),
    });
    renderPage();
    const amber = await screen.findByRole('status', { name: '1 shift à pourvoir' });
    expect(amber.textContent).toContain('jeu. 29 · 23 h – 5 h · Nora Vidal — ');
    expect(amber.textContent).toContain('— Théo est déjà sur un autre shift');
    fireEvent.click(within(amber).getByRole('button', { name: 'Voir le shift' }));
    expect((await screen.findByRole('dialog', { name: 'Théo' })).textContent).toContain(
      'Chaque mardi, 23 h – 5 h',
    );
  });

  it('says a member on leave in amber, a shift to fill on its hours by someone else (ADR 0031)', async () => {
    const written = serve({
      planning: planning([
        {
          templateId: TEMPLATE,
          startsAt: '2026-10-29T22:00:00Z',
          endsAt: '2026-10-30T04:00:00Z',
          reason: 'member_on_leave',
          leaveRequestId: LEAVE,
        },
      ]),
      members: [
        member({}),
        member({ id: BASILE, userId: id(72), firstName: 'Basile', displayName: 'Basile', color: null }),
      ],
      write: (_method, _path, body) => ({
        status: 201,
        body: { ...night, ...(typeof body === 'object' ? body : {}), id: id(102), templateId: null },
      }),
    });
    renderPage();
    const amber = await screen.findByRole('status', { name: '1 shift à pourvoir' });
    expect(amber.textContent).toContain('jeu. 29 · 23 h – 5 h · Nora Vidal — ');
    expect(amber.textContent).toContain('— Théo est en congé');
    expect(within(amber).queryByRole('button', { name: 'Voir le shift' })).toBe(null);
    fireEvent.click(within(amber).getByRole('button', { name: 'Pourvoir' }));
    const panel = await screen.findByRole('dialog', { name: 'Pourvoir un shift' });
    expect(panel.textContent).toContain('Théo est en congé : choisis qui prend ce shift.');
    // Théo is away: Basile alone is offered, on the template's hours, which are none of the slots.
    const who = within(panel).getByLabelText('Membre');
    if (!(who instanceof HTMLSelectElement)) throw new Error('no member list');
    expect([...who.options].map((option) => option.text)).toEqual(['Basile']);
    // One occurrence, never a template of its own.
    expect(within(panel).queryByRole('radiogroup', { name: 'Fréquence' })).toBe(null);
    expect(within(panel).getByRole('radio', { name: 'Autres heures' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'Placer Basile' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBe(null);
    });
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/v1/scheduling/shifts',
        body: {
          creatorId: NORA,
          platformAccountId: NORA_REVEAL,
          memberId: BASILE,
          startsAt: '2026-10-29T22:00:00.000Z',
          endsAt: '2026-10-30T04:00:00.000Z',
        },
      },
    ]);
  });

  it('approves a leave, and points at the shifts still in its way when there are some', async () => {
    // The leave starts on Wednesday 28 in Théo's zone; the night shift that runs into it started on Tuesday 27.
    const written = serve({
      leaves: [leave({ firstDay: '2026-10-28', startsAt: '2026-10-27T23:00:00Z' })],
      write: () => ({
        status: 409,
        body: {
          error: {
            code: 'leave_shifts_conflict',
            message: 'shifts',
            details: { shiftIds: [NIGHT] },
            requestId: 'r3',
          },
        },
      }),
    });
    renderPage();
    const decide = await decideFold();
    expect(text(decide)).toContain('ThéoDu mer. 28 oct. au ven. 30 oct., 3 jours');
    // Said before Valider, from the planning of the leave's days (EQ-16).
    await waitFor(() => {
      expect(text(decide)).toContain('1 shift à donner avant de valider');
    });
    expect(text(decide)).toContain('« Examens »');
    fireEvent.click(within(decide).getByRole('button', { name: 'Valider' }));
    // Said at once, then with its day once the planning of the leave is read.
    await within(decide).findByRole('alert');
    await waitFor(() => {
      expect(text(within(decide).getByRole('alert'))).toBe(
        'Un shift de Théo tombe encore pendant ce congé, le mar. 27 oct. : donne-le à quelqu’un d’autre ou annule-le d’abord.Voir le shift',
      );
    });
    expect(written).toEqual([
      {
        method: 'POST',
        path: `/v1/scheduling/leave-requests/${LEAVE}/decision`,
        body: { decision: 'approve' },
      },
    ]);
    expect(screen.queryAllByRole('button', { name: /pendant un congé à valider$/u })).toEqual([]);
    fireEvent.click(within(decide).getByRole('button', { name: 'Voir le shift' }));
    const flagged = await screen.findAllByRole('button', { name: /pendant un congé à valider$/u });
    expect(flagged.map((chip) => chip.getAttribute('data-flagged'))).toEqual(flagged.map(() => 'true'));
  });

  it('counts the shifts to give as the server does: a shift of the leave already over is not one (EQ-16)', async () => {
    // A leave from Monday 26, still to decide on Wednesday: Monday's shift is done, Tuesday's night is under way.
    const monday = {
      ...night,
      id: id(106),
      startsAt: '2026-10-26T05:00:00Z',
      endsAt: '2026-10-26T11:00:00Z',
    };
    serve({
      planning: planning([], [monday, night]),
      leaves: [leave({ firstDay: '2026-10-26', startsAt: '2026-10-25T23:00:00Z' })],
    });
    renderPage();
    const decide = await decideFold();
    await waitFor(() => {
      expect(text(decide)).toContain('1 shift à donner avant de valider');
    });
  });

  it('takes « Voir le shift » to the first shift in the way, whatever its week and filter, while the leave waits', async () => {
    const LEA = id(2);
    const LEA_REVEAL = id(12);
    // Théo's leave runs over two weeks; the shift in its way is on the second one, Tuesday 3 at 23 h in Paris.
    const later = { ...night, id: id(105), startsAt: '2026-11-03T22:00:00Z', endsAt: '2026-11-04T04:00:00Z' };
    const long = leave({ lastDay: '2026-11-06', endsAt: '2026-11-06T23:00:00Z' });
    const leaves: unknown[] = [long];
    const accounts = [
      ...ACCOUNTS,
      { id: LEA_REVEAL, creatorId: LEA, creatorName: 'Léa Roux', platform: 'reveal', handle: 'lea' },
    ];
    let tries = 0;
    serve({
      leaves,
      // This week has the night shift; the next one, and the leave's own days, the shift in the way.
      planningOf: (from) => planning([], from === '2026-10-25T23:00:00.000Z' ? [night] : [later], accounts),
      write: () => {
        tries += 1;
        if (tries > 1) {
          leaves.splice(0, 1, leave({ ...long, status: 'refused', decidedAt: NOW.toISOString() }));
          return { status: 200, body: leaves[0] };
        }
        return {
          status: 409,
          body: {
            error: {
              code: 'leave_shifts_conflict',
              message: 'shifts',
              details: { shiftIds: [id(105)] },
              requestId: 'r4',
            },
          },
        };
      },
    });
    renderPage();
    // The reader looks at Léa's accounts only.
    fireEvent.click(await screen.findByRole('radio', { name: 'Léa Roux' }));
    const decide = await decideFold();
    fireEvent.click(within(decide).getByRole('button', { name: 'Valider' }));
    await waitFor(() => {
      expect(text(within(decide).getByRole('alert'))).toContain(
        'Un shift de Théo tombe encore pendant ce congé, le mar. 3 nov. : donne-le',
      );
    });
    fireEvent.click(within(decide).getByRole('button', { name: 'Voir le shift' }));
    // The week of the shift, every creator, its day picked for the phone, the shift lit.
    expect(text(await screen.findByRole('group', { name: 'Semaine' }))).toContain('2 nov. – 8 nov.');
    expect(screen.getByRole('radio', { name: 'Toutes' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: /^mar\.\s*3$/u }).getAttribute('aria-checked')).toBe('true');
    const lit = async (): Promise<string[]> =>
      (await screen.findAllByRole('button', { name: /^Théo, / })).map(
        (chip) => chip.getAttribute('data-flagged') ?? 'none',
      );
    await waitFor(async () => {
      expect(await lit()).toContain('true');
    });
    // Away and back, it is still lit.
    fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
    fireEvent.click(screen.getByRole('button', { name: 'Semaine précédente' }));
    await waitFor(async () => {
      expect(await lit()).toContain('true');
    });
    // Once the leave is decided, nothing is lit any more.
    fireEvent.click(within(decide).getByRole('button', { name: 'Refuser' }));
    fireEvent.click(await within(decide).findByRole('button', { name: 'Refuser la demande' }));
    await waitFor(async () => {
      expect(await lit()).not.toContain('true');
    });
  });

  it('refuses a leave with a word for the member', async () => {
    const written = serve({
      leaves: [leave()],
      write: () => ({ status: 200, body: leave({ status: 'refused', decisionNote: 'Semaine chargée' }) }),
    });
    renderPage();
    const decide = await decideFold();
    fireEvent.click(within(decide).getByRole('button', { name: 'Refuser' }));
    fireEvent.change(within(decide).getByLabelText(/Un mot pour Théo/u), {
      target: { value: 'Semaine chargée' },
    });
    fireEvent.click(within(decide).getByRole('button', { name: 'Refuser la demande' }));
    await waitFor(() => {
      expect(written).toEqual([
        {
          method: 'POST',
          path: `/v1/scheduling/leave-requests/${LEAVE}/decision`,
          body: { decision: 'refuse', note: 'Semaine chargée' },
        },
      ]);
    });
  });

  it('leaves a manager’s own leave to the owner', async () => {
    serve({ leaves: [leave()], members: [member({ userId: OWNER_USER, teamRole: 'manager' })] });
    renderPage();
    const decide = await decideFold();
    await waitFor(() => {
      expect(text(decide)).toContain('Le propriétaire décide de ton congé.');
    });
    expect(within(decide).queryByRole('button', { name: 'Valider' })).toBe(null);
  });

  it('says who is on leave this week, and cancels a leave after a confirmation', async () => {
    const written = serve({
      leaves: [leave({ status: 'approved', decidedAt: '2026-10-27T12:00:00Z' })],
      write: () => ({ status: 204 }),
    });
    renderPage();
    const away = await screen.findByRole('region', { name: 'En congé cette semaine' });
    expect(screen.queryByText(/congés? à valider/u)).toBe(null);
    fireEvent.click(within(away).getByRole('button', { name: /^Théo/u }));
    const confirm = within(away).getByRole('alertdialog', { name: 'Congé de Théo' });
    expect(text(confirm)).toContain('L’annuler rend Théo planifiable dès maintenant');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Annuler le congé' }));
    await waitFor(() => {
      expect(written).toEqual([
        { method: 'DELETE', path: `/v1/scheduling/leave-requests/${LEAVE}`, body: null },
      ]);
    });
  });

  it('folds the chatters’ swaps, withdraws a proposal and undoes an accepted one', async () => {
    const written = serve({
      swaps: [
        swap(),
        swap({ id: id(62), status: 'accepted', resolvedAt: '2026-10-27T12:00:00Z' }),
        swap({
          id: id(63),
          status: 'withdrawn',
          withdrawnByAgency: true,
          resolvedAt: '2026-10-27T13:00:00Z',
        }),
      ],
      write: () => ({ status: 204 }),
    });
    renderPage();
    const fold = (await screen.findByText('Échanges entre chatteurs')).closest('details');
    if (fold === null) throw new Error('no swaps');
    expect(text(fold)).toContain('1 en attente · 1 accepté');
    expect(text(fold)).toContain('Théo donne son shift à Basile');
    expect(text(fold)).toContain('En attente de Basile');
    expect(text(fold)).toContain('Retiré par l’agence');
    fireEvent.click(within(fold).getByRole('button', { name: 'Retirer la proposition' }));
    fireEvent.click(within(fold).getByRole('button', { name: 'Annuler l’échange' }));
    const confirm = within(fold).getByRole('alertdialog', { name: 'Confirmer' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Annuler l’échange' }));
    await waitFor(() => {
      expect(written.map(({ method, path }) => `${method} ${path}`)).toEqual([
        `DELETE /v1/scheduling/swap-requests/${id(61)}`,
        `DELETE /v1/scheduling/swap-requests/${id(62)}`,
      ]);
    });
  });

  it('places a shift, and names the one in the way when the member is taken', async () => {
    const written = serve({
      write: () => ({
        status: 409,
        body: {
          error: {
            code: 'shift_member_conflict',
            message: 'taken',
            details: { shiftId: NIGHT },
            requestId: 'r1',
          },
        },
      }),
    });
    renderPage();
    await screen.findByRole('row', { name: /Nora Vidal/u });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    // At 1 h, the night slot has begun: the panel opens on the next one.
    expect(within(panel).getByRole('radio', { name: '6 h – 12 h' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(panel).getByRole('radio', { name: '12 h – 18 h' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Placer Théo' }));
    expect((await within(panel).findByRole('alert')).textContent).toContain(
      'Ce membre est déjà sur un autre shift à ces heures.',
    );
    expect(written).toEqual([
      {
        method: 'POST',
        path: '/v1/scheduling/shifts',
        body: {
          creatorId: NORA,
          platformAccountId: NORA_REVEAL,
          memberId: THEO,
          startsAt: '2026-10-28T11:00:00.000Z',
          endsAt: '2026-10-28T17:00:00.000Z',
        },
      },
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: 'Voir le shift gênant' }));
    expect(await screen.findByRole('dialog', { name: 'Théo' })).toBeTruthy();
  });

  it('stops a shift under way at the minute, after a confirmation', async () => {
    const written = serve({ write: () => ({ status: 200, body: { ...night, endsAt: NOW.toISOString() } }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Théo, 23\u00a0h – 5\u00a0h/u }));
    const sheet = await screen.findByRole('dialog', { name: 'Théo' });
    expect(sheet.textContent).toContain('En poste');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Arrêter maintenant' }));
    expect(written).toEqual([]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Arrêter' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(written).toEqual([
      {
        method: 'PATCH',
        path: `/v1/scheduling/shifts/${NIGHT}`,
        body: { endsAt: '2026-10-28T00:00:00.000Z' },
      },
    ]);
  });

  it('types the hours of a shift on 24 hours, in the sheet and the panel, whatever the browser’s language', async () => {
    serve({});
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Théo, 23\u00a0h – 5\u00a0h/u }));
    const sheet = await screen.findByRole('dialog', { name: 'Théo' });
    const end = within(sheet).getByLabelText('Fin');
    expect(end).toHaveProperty('type', 'text');
    expect(end).toHaveProperty('value', '05:00');
    fireEvent.change(end, { target: { value: '4h30' } });
    fireEvent.blur(end);
    expect(end).toHaveProperty('value', '04:30');
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres heures' }));
    const start = within(panel).getByLabelText('Début');
    expect(start).toHaveProperty('type', 'text');
    fireEvent.change(start, { target: { value: '21h30' } });
    fireEvent.blur(start);
    expect(start).toHaveProperty('value', '21:30');
  });

  it('never saves another hour than the one typed: « 22h7 » stays, marked, and Enter sends nothing', async () => {
    const written = serve({ write: () => ({ status: 200, body: night }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Théo, 23\u00a0h – 5\u00a0h/u }));
    const sheet = await screen.findByRole('dialog', { name: 'Théo' });
    const end = within(sheet).getByLabelText('Fin');
    fireEvent.change(end, { target: { value: '22h7' } });
    fireEvent.blur(end);
    expect(end).toHaveProperty('value', '22h7');
    expect(end.getAttribute('aria-invalid')).toBe('true');
    expect(within(sheet).getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
    // Enter submits the form even while « Enregistrer » is off.
    fireEvent.submit(end.closest('form') ?? sheet);
    expect(sheet.isConnected).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres heures' }));
    const start = within(panel).getByLabelText('Début');
    fireEvent.change(start, { target: { value: '22h7' } });
    fireEvent.blur(start);
    expect(start).toHaveProperty('value', '22h7');
    expect(within(panel).getByText('Une heure sur 24 heures : 22, 2230 ou 22:30.')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Placer Théo' })).toHaveProperty('disabled', true);
    fireEvent.submit(start.closest('form') ?? panel);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(written).toEqual([]);
  });

  it('closes the sheet when a stop in the first minute cancels the shift (204)', async () => {
    const written = serve({ write: () => ({ status: 204 }) });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Théo, 23\u00a0h – 5\u00a0h/u }));
    const sheet = await screen.findByRole('dialog', { name: 'Théo' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Arrêter maintenant' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Arrêter' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(written.map(({ method }) => method)).toEqual(['PATCH']);
  });

  it('keeps a shift template under 23 hours, and words a body the server refuses', async () => {
    const written = serve({
      write: () => ({
        status: 400,
        body: { error: { code: 'request_invalid', message: 'bad', details: {}, requestId: 'r2' } },
      }),
    });
    renderPage();
    await screen.findByRole('row', { name: /Nora Vidal/u });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres heures' }));
    fireEvent.change(within(panel).getByLabelText('Début'), { target: { value: '08:00' } });
    fireEvent.change(within(panel).getByLabelText('Fin'), { target: { value: '07:30' } });
    // 23 h 30 is a shift, not a template: a change of time would stretch it past a day.
    expect(panel.textContent).toContain('23 h 30, jusqu’au lendemain.');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Chaque semaine' }));
    expect(await screen.findByRole('dialog', { name: 'Nouveau modèle de shift' })).toBe(panel);
    expect(panel.textContent).toContain('Un modèle de shift dure 23 heures au plus.');
    const place = within(panel).getByRole('button', { name: 'Placer Théo' });
    expect(place.hasAttribute('disabled')).toBe(true);

    fireEvent.change(within(panel).getByLabelText('Fin'), { target: { value: '07:00' } });
    expect(place.hasAttribute('disabled')).toBe(false);
    fireEvent.click(place);
    expect((await within(panel).findByRole('alert')).textContent).toContain('Ces valeurs ne vont pas');
    expect(written.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST /v1/scheduling/shift-templates',
    ]);
  });

  it('marks the shift whose report says an incident, and its sheet says the report (EQ-03)', async () => {
    const past = (n: number, day: string) => ({
      ...night,
      id: id(n),
      startsAt: `${day}T15:00:00Z`,
      endsAt: `${day}T21:00:00Z`,
      templateId: null,
    });
    const report = {
      id: id(301),
      shiftId: id(103),
      creatorId: NORA,
      platformAccountId: NORA_REVEAL,
      memberId: THEO,
      period: '2026-10-16',
      correctsId: null,
      amount: { amountMinor: 21_240, currency: 'EUR' },
      comment: null,
      incident: 'Reveal a coupé vingt minutes vers 21 h.',
      status: 'submitted',
      version: 1,
      byAgency: false,
      canReview: true,
      submittedAt: '2026-10-26T21:05:00Z',
      reviewedAt: null,
      reviewNote: null,
      createdAt: '2026-10-26T21:05:00Z',
    };
    serve({
      planning: planning([], [night, past(103, '2026-10-26'), past(104, '2026-10-27')]),
      reports: [report],
    });
    renderPage();

    const marked = await screen.findByRole('button', { name: /incident signalé/u });
    expect(screen.getAllByRole('button', { name: /incident signalé/u })).toHaveLength(1);
    fireEvent.click(marked);
    const sheet = screen.getByRole('dialog');
    expect(text(sheet)).toContain('212,40 €');
    expect(within(sheet).getByText('À valider')).toBeTruthy();
    expect(text(sheet)).toContain('Incident Reveal a coupé vingt minutes vers 21 h.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fermer' }));

    fireEvent.click(screen.getByRole('button', { name: /^Théo, 16\sh\s–\s22\sh$/u }));
    const over = screen.getByRole('dialog');
    // « Sans rapport » leads to his fold of the period in Rapports, his name to his record (EQ-11, EQ-13).
    expect(within(over).getByRole('link', { name: 'Sans rapport' }).getAttribute('href')).toBe(
      `/equipe/rapports?quinzaine=2026-10-16&membre=${THEO}`,
    );
    expect(within(over).getByRole('link', { name: 'Théo' }).getAttribute('href')).toBe(
      `/equipe/membres?membre=${THEO}`,
    );
    expect(text(over)).not.toContain('Ce shift est fini');
  });

  it('makes one member’s shifts stand out from his record, and gives the whole team back (EQ-11)', async () => {
    // Another member's night on Thursday: not in the planning's names, so said « Un membre ».
    const other = {
      ...night,
      id: id(107),
      memberId: BASILE,
      startsAt: '2026-10-29T22:00:00Z',
      endsAt: '2026-10-30T04:00:00Z',
    };
    serve({ planning: planning([], [night, other]) });
    const router = renderPage(`/equipe/planning?membre=${THEO}`);
    const name = await screen.findByText('Théo', { selector: '.sc-focus b' }, { timeout: 4_000 });
    expect(text(name.closest('.sc-focus'))).toContain('Théo · 1 shift · 6 h');
    expect(screen.getByRole('button', { name: /^Théo, 23\sh/u }).getAttribute('data-muted')).toBe(null);
    expect(screen.getByRole('button', { name: /^Un membre, 23\sh/u }).getAttribute('data-muted')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Toute l’équipe' }));
    await waitFor(() => {
      expect(document.querySelector('.sc-focus')).toBe(null);
    });
    expect(router.state.location.search).toEqual({});
    // The button went with the band: the focus lands on the week, which stays.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Semaine précédente' }));
  });

  it('names the member put forward from the team, even with no shift in the week', async () => {
    serve({
      members: [
        member({}),
        member({ id: BASILE, userId: id(72), firstName: 'Basile', displayName: 'Basile', color: null }),
      ],
    });
    renderPage(`/equipe/planning?membre=${BASILE}`);
    const band = await screen.findByText('Basile', { selector: '.sc-focus b' }, { timeout: 4_000 });
    expect(text(band.closest('.sc-focus'))).toContain('Basile · aucun shift cette semaine');
    // A landmark, not an announcement.
    expect(band.closest('.sc-focus')?.getAttribute('role')).toBe(null);
  });

  it('says how long a single shift really lasts the night the clocks go forward', async () => {
    serve();
    renderPage();
    await screen.findByRole('row', { name: /Nora Vidal/u });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    fireEvent.change(within(panel).getByLabelText('Jour'), { target: { value: '2027-03-28' } });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres heures' }));
    fireEvent.change(within(panel).getByLabelText('Début'), { target: { value: '00:00' } });
    fireEvent.change(within(panel).getByLabelText('Fin'), { target: { value: '06:00' } });
    // 2 h becomes 3 h in Paris: the night shift lasts 5 h; a template keeps its wall-clock 6 h.
    expect(panel.textContent).toContain('5 h.');
    fireEvent.click(within(panel).getByRole('radio', { name: 'Chaque semaine' }));
    expect(panel.textContent).toContain('6 h.');
  });

  it('refuses a single shift of more than 24 h the night the clocks go back', async () => {
    serve();
    renderPage();
    await screen.findByRole('row', { name: /Nora Vidal/u });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    fireEvent.change(within(panel).getByLabelText('Jour'), { target: { value: '2027-10-31' } });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres heures' }));
    fireEvent.change(within(panel).getByLabelText('Début'), { target: { value: '02:30' } });
    fireEvent.change(within(panel).getByLabelText('Fin'), { target: { value: '02:00' } });
    const place = within(panel).getByRole('button', { name: 'Placer Théo' });
    // 3 h comes back to 2 h that night: 23 h 30 on the clock is 24 h 30 of shift.
    expect(text(panel)).toContain(
      '24 h 30 cette nuit-là, à cause du changement d’heure : un shift dure 24 h au plus.',
    );
    expect(place.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(panel).getByLabelText('Fin'), { target: { value: '01:30' } });
    expect(place.hasAttribute('disabled')).toBe(false);
  });

  it('places no member before the day he joins', async () => {
    serve({ members: [member({ joinedOn: '2026-11-05' })] });
    renderPage();
    await screen.findByRole('row', { name: /Nora Vidal/u });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter un shift' }));
    const panel = await screen.findByRole('dialog', { name: 'Nouveau shift' });
    fireEvent.change(within(panel).getByLabelText('Jour'), { target: { value: '2026-11-04' } });
    const place = within(panel).getByRole('button', { name: 'Placer Théo' });
    expect(text(panel)).toContain('Théo arrive le jeudi 5 novembre : un jour à partir de son arrivée.');
    expect(place.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(panel).getByLabelText('Jour'), { target: { value: '2026-11-05' } });
    expect(place.hasAttribute('disabled')).toBe(false);
  });

  it('hands a shift only to a member who has joined by its day', async () => {
    const later = { ...night, id: id(105), startsAt: '2026-10-29T22:00:00Z', endsAt: '2026-10-30T04:00:00Z' };
    serve({
      planning: planning([], [{ ...later, templateId: null }]),
      members: [
        member({}),
        member({ id: BASILE, userId: id(72), firstName: 'Basile', displayName: 'Basile', color: null }),
        member({
          id: id(23),
          userId: id(73),
          firstName: 'Iris',
          displayName: 'Iris',
          color: null,
          joinedOn: '2026-11-05',
        }),
      ],
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Théo, 23\sh\s–\s5\sh/u }));
    const who = within(screen.getByRole('dialog')).getByLabelText('Membre');
    if (!(who instanceof HTMLSelectElement)) throw new Error('no member list');
    expect([...who.options].map((option) => option.text)).toEqual(['Basile', 'Théo']);
  });

  it('keeps the week shown in the address, so that a reload or a back finds it', async () => {
    const asked: string[] = [];
    serve({
      planningOf: (from) => {
        asked.push(from);
        return planning();
      },
    });
    const router = renderPage('/equipe/planning?semaine=2026-10-14');
    await screen.findByRole('row', { name: /Nora Vidal/u });
    // The 14th is said as its week's Monday, the 12th.
    expect(router.state.location.search).toEqual({ semaine: '2026-10-12' });
    expect(asked.at(-1)?.startsWith('2026-10-1')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ semaine: '2026-10-19' });
    });
    // Back on this week, the address says nothing more.
    fireEvent.click(screen.getByRole('button', { name: 'Semaine suivante' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
  });

  it('names each + by its account, two accounts of a creator never the same', async () => {
    const second = { ...ACCOUNTS[0], id: id(12), handle: 'nora-2' };
    serve({ planning: planning([], [night], [...ACCOUNTS, second]) });
    renderPage();
    await screen.findAllByRole('row', { name: /Nora Vidal/u });
    expect(
      screen
        .getAllByRole('button', { name: /^Ajouter un shift le mercredi 28 octobre sur Nora Vidal/u })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Ajouter un shift le mercredi 28 octobre sur Nora Vidal, @nora sur Reveal',
      'Ajouter un shift le mercredi 28 octobre sur Nora Vidal, @nora-2 sur Reveal',
    ]);
  });
});
