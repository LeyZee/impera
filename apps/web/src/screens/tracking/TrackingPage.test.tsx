// @vitest-environment jsdom
import {
  ConversationDetailSchema,
  ConversationIdSchema,
  ConversationSummarySchema,
  DashboardSchema,
  DraftIdSchema,
  MessageViewSchema,
  type ConversationDetail,
  type ConversationSummary,
  type FanFlags,
  type KycSlot,
} from '@nirvana/contracts';
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

import { TrackingPage } from './TrackingPage';
import { parseTrackingSearch } from './view';

import { apiDashboard } from '@/test/fakes';

/* Invented creators and fans: no real data. */
const LEA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Léa', timezone: 'Europe/Paris' };
const NINA = { id: '0192f3a0-0000-7000-8000-0000000000c2', displayName: 'Nina', timezone: 'Europe/Paris' };
const DRAFT = DraftIdSchema.parse('0192f3a0-0000-7000-8000-0000000000d1');

function conversation(id: string, patch: Partial<ConversationSummary> = {}): ConversationSummary {
  return ConversationSummarySchema.parse({
    id: `0192f3a0-0000-7000-8000-00000000000${id}`,
    fanId: `0192f3a0-0000-7000-8000-0000000000f${id}`,
    fanDisplayName: `Fan ${id}`,
    state: 'idle',
    mode: 'copilot',
    lastInboundAt: null,
    lastOutboundAt: null,
    unreadCount: 0,
    updatedAt: '2026-10-17T20:00:00Z',
    desire: null,
    ...patch,
  });
}

/** Fan 1 waits for a draft: « Coucou toi » then « Tu fais quoi ? ». */
function waiting(patch: Partial<ConversationDetail> = {}): ConversationDetail {
  return ConversationDetailSchema.parse({
    ...conversation('1', { state: 'awaiting_approval' }),
    openDrafts: [
      {
        id: DRAFT,
        status: 'pending',
        bubbles: ['Coucou toi', 'Tu fais quoi ?'],
        finalBubbles: null,
        createdAt: '2026-10-17T20:01:00Z',
      },
    ],
    failedDraft: null,
    ...patch,
  });
}

const FAN_MESSAGE = MessageViewSchema.parse({
  id: '0192f3a0-0000-7000-8000-000000000101',
  direction: 'inbound',
  author: 'fan',
  text: 'Salut, ça va ?',
  media: [],
  priceMinor: null,
  currency: null,
  isPaid: false,
  draftId: null,
  platformCreatedAt: '2026-10-17T20:00:00Z',
});

interface Reply {
  status: number;
  body?: unknown;
}

/** One POST the fake server received: the action (`approve`, `takeover`…) and its JSON body. */
interface Posted {
  readonly action: string;
  readonly body: unknown;
}

/**
 * A fake server: `/v1/creators`, `/v1/conversations` by creator id, `/v1/dashboard`, one conversation's detail,
 * messages and events, and the commands, which answer `command` (204 by default) and are recorded in `posted`.
 */
function serve(routes: {
  creators: Reply | (() => Reply);
  conversations?: Record<string, { items: ConversationSummary[]; nextCursor: string | null }>;
  dashboard?: Reply;
  detail?: () => Reply;
  command?: (action: string) => Reply;
  /** The fan's limits read first, and after a `PUT` (the same when not given). */
  flags?: { before?: FanFlags; after?: FanFlags };
  /** Whether this person may confirm a disputed age (the owner or a manager); not by default. */
  mayConfirmDisputedAge?: boolean;
  /** His desire curve (`/desire`), no point when not given. */
  desire?: Reply;
  /** The canvas lines left to learn about him (`/kyc`), none when not given; `down` answers 500. */
  kyc?: KycSlot[] | 'down';
  /** What happened to the conversation, newest first; none when not given. */
  events?: unknown[];
  /** `GET` of his limits answers 403: the server will not show them to this person. */
  flagsRefused?: boolean;
  /** The thread's messages, newest first; one message of his when not given. */
  messages?: unknown[];
  /** « À traiter » across creators; the Dashboard's todos, named after its creator, when not given. */
  todos?: Reply | (() => Reply);
}): Posted[] {
  const posted: Posted[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const path = url.pathname;
      let reply: Reply;
      const flagsView = (flags: FanFlags = {}): Reply => ({
        status: 200,
        body: {
          fanId: path.split('/')[3],
          flags,
          mayConfirmDisputedAge: routes.mayConfirmDisputedAge ?? false,
        },
      });
      if (init?.method === 'POST' || init?.method === 'PUT') {
        const action = path.split('/').at(-1) ?? '';
        posted.push({ action, body: JSON.parse(typeof init.body === 'string' ? init.body : 'null') });
        reply =
          routes.command?.(action) ??
          (init.method === 'PUT' ? flagsView(routes.flags?.after ?? routes.flags?.before) : { status: 204 });
      } else if (path.startsWith('/v1/fans/') && path.endsWith('/kyc')) {
        reply =
          routes.kyc === 'down'
            ? { status: 500 }
            : { status: 200, body: { fanId: path.split('/')[3], toLearn: routes.kyc ?? [] } };
      } else if (path.startsWith('/v1/fans/')) {
        reply = routes.flagsRefused === true ? { status: 403 } : flagsView(routes.flags?.before);
      } else if (path === '/v1/creators') {
        reply = typeof routes.creators === 'function' ? routes.creators() : routes.creators;
      } else if (path === '/v1/conversations') {
        reply = { status: 200, body: routes.conversations?.[url.searchParams.get('creatorId') ?? ''] };
      } else if (path === '/v1/dashboard/todos') {
        const dashboard = DashboardSchema.parse(
          (routes.dashboard ?? { status: 200, body: apiDashboard({ todos: [] }) }).body,
        );
        reply = (typeof routes.todos === 'function' ? routes.todos() : routes.todos) ?? {
          status: 200,
          body: {
            items: dashboard.todos.map((todo) => ({
              ...todo,
              creatorId: dashboard.creator.id,
              creatorName: dashboard.creator.name,
            })),
            creators: [],
          },
        };
      } else if (path === '/v1/dashboard') {
        reply = routes.dashboard ?? { status: 200, body: apiDashboard({ todos: [] }) };
      } else if (path.endsWith('/messages')) {
        reply = { status: 200, body: { items: routes.messages ?? [FAN_MESSAGE], nextCursor: null } };
      } else if (path.endsWith('/events')) {
        reply = { status: 200, body: { items: routes.events ?? [], nextCursor: null } };
      } else if (path.endsWith('/desire')) {
        reply = routes.desire ?? { status: 200, body: { points: [] } };
      } else {
        reply = routes.detail?.() ?? { status: 404 };
      }
      if (reply.status === 204) return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(JSON.stringify(reply.body ?? null), { status: reply.status }));
    }),
  );
  return posted;
}

/** The calls the reader made for what is left to learn about the fan. */
const kycCalls = (): unknown[] =>
  vi.mocked(fetch).mock.calls.filter(([input]) => typeof input === 'string' && input.includes('/kyc?'));

/** Suivi as the app mounts it: the open conversation lives in the address. */
function renderPage(at = '/suivi', canDecide = true, canAddCreator = true): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const tracking = createRoute({
    getParentRoute: () => root,
    path: '/suivi',
    validateSearch: parseTrackingSearch,
    component: function Tracking() {
      const { conversation, creatrice } = tracking.useSearch();
      const navigate = tracking.useNavigate();
      return (
        <TrackingPage
          selected={conversation ?? null}
          selectedCreator={creatrice ?? null}
          onSelect={(id) => void navigate({ search: id === null ? {} : { conversation: id } })}
          canDecide={canDecide}
          canAddCreator={canAddCreator}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([tracking, createRoute({ getParentRoute: () => root, path: '/creatrices' })]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** jsdom has no scrolling: what the reader brings into view is recorded here. */
const scrollIntoView = vi.fn();

const ONE = { creators: { status: 200, body: { creators: [LEA] } } };
const OPEN = `/suivi?conversation=${conversation('1').id}`;

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TrackingPage', () => {
  it('sends to Créatrices when there is no creator yet, with no developer command', async () => {
    serve({ creators: { status: 200, body: { creators: [] } } });
    renderPage();
    expect(await screen.findByText('Aucune créatrice pour l’instant')).toBeDefined();
    expect(screen.getByRole('link', { name: 'Aller à Créatrices' }).getAttribute('href')).toBe('/creatrices');
    expect(screen.queryByText(/pnpm/u)).toBeNull();
  });

  it('never sends a team member to Créatrices, which is not in his rail', async () => {
    serve({ creators: { status: 200, body: { creators: [] } } });
    renderPage('/suivi', true, false);
    expect(await screen.findByText('Rien pour toi pour l’instant')).toBeDefined();
    expect(screen.queryByText('Aucune créatrice pour l’instant')).toBeNull();
    expect(document.querySelector('a[href="/creatrices"]')).toBeNull();
  });

  it('says « À traiter » could not be read, in amber, and Réessayer reads it again', async () => {
    const [kevin] = apiDashboard().todos;
    if (kevin === undefined) throw new Error('no todo');
    let calls = 0;
    serve({
      ...ONE,
      conversations: { [LEA.id]: { items: [conversation('1')], nextCursor: null } },
      todos: () =>
        ++calls === 1
          ? { status: 500 }
          : {
              status: 200,
              body: { items: [{ ...kevin, creatorId: LEA.id, creatorName: 'Léa' }], creators: [] },
            },
    });
    renderPage();
    const warning = await screen.findByText(/« À traiter » n’a pas pu être lu/u);
    expect(warning.classList.contains('tr-warn')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('list', { name: 'À traiter' })).toBeDefined();
    expect(screen.queryByText(/« À traiter » n’a pas pu être lu/u)).toBeNull();
  });

  it('says the server does not answer, and Réessayer reads again', async () => {
    // The read and its one retry fail (CREA-30); « Réessayer » reads again.
    let calls = 0;
    serve({
      creators: () => (++calls <= 2 ? { status: 500 } : { status: 200, body: { creators: [LEA] } }),
      conversations: { [LEA.id]: { items: [conversation('1')], nextCursor: null } },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Fan 1')).toBeDefined();
    expect(screen.queryByText('Le serveur ne répond pas')).toBeNull();
  });

  it('lists the conversations of one creator, most recent first, with their state', async () => {
    serve({
      ...ONE,
      conversations: {
        [LEA.id]: {
          items: [
            conversation('1', { updatedAt: '2026-10-17T18:00:00Z' }),
            conversation('2', {
              fanDisplayName: '  ',
              state: 'awaiting_approval',
              unreadCount: 3,
              updatedAt: '2026-10-17T20:30:00Z',
            }),
          ],
          nextCursor: 'next',
        },
      },
    });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Conversations' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.nv-convo__name')?.textContent)).toEqual([
      'Fan sans nom',
      'Fan 1',
    ]);
    expect(rows[0]?.textContent).toContain('À valider');
    expect(rows[0]?.textContent).toContain('3 non lus');
    // One creator: her name heads the page, not every row.
    expect(screen.getByText('Léa')).toBeDefined();
    expect(rows[1]?.textContent).not.toContain('Léa');
    expect(screen.getByText('Seules les plus récentes sont affichées.')).toBeDefined();
  });

  it('names the creator on each row when the account sees several', async () => {
    serve({
      creators: { status: 200, body: { creators: [LEA, NINA] } },
      conversations: {
        [LEA.id]: { items: [conversation('1')], nextCursor: null },
        [NINA.id]: { items: [conversation('2')], nextCursor: null },
      },
    });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Conversations' });
    // Beside his pseudo, apart from the line a narrow row cuts.
    const names = within(list)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.tr-row__creator')?.textContent);
    expect(names).toContain('Léa');
    expect(names).toContain('Nina');
  });

  it('opens a conversation outside every list when the link names its creator (Dashboard, fan reader)', async () => {
    const routes = {
      creators: { status: 200, body: { creators: [LEA, NINA] } },
      conversations: {
        [LEA.id]: { items: [conversation('1')], nextCursor: null },
        [NINA.id]: { items: [], nextCursor: null },
      },
      detail: () => ({ status: 200, body: waiting({ state: 'human', openDrafts: [] }) }),
    };
    serve(routes);
    const elsewhere = conversation('9').id;
    renderPage(`/suivi?conversation=${elsewhere}&creatrice=${NINA.id}`);
    expect(await screen.findByText('Salut, ça va ?')).toBeDefined();

    // Without the creator, several creators and no list holding it: the page cannot tell whose it is.
    cleanup();
    serve(routes);
    renderPage(`/suivi?conversation=${elsewhere}`);
    expect(await screen.findByText('Cette conversation n’est pas dans la liste.')).toBeDefined();
  });

  it('gathers what waits for a human for every creator followed, each line naming hers (SUIVI-09)', async () => {
    const INES = {
      id: '0192f3a0-0000-7000-8000-0000000000c2',
      displayName: 'Inès',
      timezone: 'Europe/Paris',
    };
    const arthur = '0192f3a0-0000-7000-8000-0000000000a9';
    const [kevin] = apiDashboard().todos;
    if (kevin === undefined) throw new Error('no todo');
    serve({
      creators: { status: 200, body: { creators: [LEA, INES] } },
      conversations: {
        [LEA.id]: { items: [conversation('1')], nextCursor: null },
        [INES.id]: { items: [], nextCursor: null },
      },
      todos: {
        status: 200,
        body: {
          items: [
            { ...kevin, creatorId: LEA.id, creatorName: 'Léa' },
            {
              ...kevin,
              id: 'todo-2',
              tone: 'warn',
              kind: 'awaiting_approval',
              title: 'Arthur',
              conversationId: arthur,
              creatorId: INES.id,
              creatorName: 'Inès',
            },
          ],
          creators: [],
        },
      },
      detail: () => ({ status: 200, body: { ...waiting(), id: arthur, fanDisplayName: 'Arthur' } }),
    });
    renderPage();
    const queue = await screen.findByRole('list', { name: 'À traiter' });
    const rows = within(queue).getAllByRole('button');
    expect(rows.map((row) => row.querySelector('.nv-convo__name')?.textContent)).toEqual([
      'Léa · Mineur possible · Kévin',
      'Inès · Brouillon à valider · Arthur',
    ]);
    // Inès's conversation is not in the loaded list: it opens with her id, from the queue's line.
    const second = rows[1];
    if (second === undefined) throw new Error('no second line');
    fireEvent.click(second);
    await waitFor(() => {
      const details = vi
        .mocked(fetch)
        .mock.calls.flatMap(([input]) => (typeof input === 'string' ? [input] : []))
        .filter((url) => url.startsWith(`/v1/conversations/${arthur}?`));
      expect(details[0]).toContain(`creatorId=${INES.id}`);
    });
  });

  it('puts first what waits for a human, as the server computed it, and opens it', async () => {
    serve({
      ...ONE,
      conversations: { [LEA.id]: { items: [conversation('1')], nextCursor: null } },
      // The default todo: Kévin, a possible minor, on conversation 1.
      dashboard: { status: 200, body: apiDashboard() },
      detail: () => ({ status: 200, body: waiting({ state: 'human', openDrafts: [] }) }),
    });
    renderPage();
    const queue = await screen.findByRole('list', { name: 'À traiter' });
    expect(queue.textContent).toContain('Mineur possible · Kévin');
    expect(queue.textContent).toContain('19 min');
    fireEvent.click(within(queue).getByRole('button'));
    expect(await screen.findByText('Salut, ça va ?')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Rendre la main à l’agent' })).toBeDefined();
  });

  it('shows the three gravest of « À traiter », and the others on demand', async () => {
    const [first] = apiDashboard().todos;
    if (first === undefined) throw new Error('the fake dashboard has a todo');
    const todo = (n: number) => ({
      ...first,
      id: `todo-${String(n)}`,
      title: `Fan ${String(n)}`,
      conversationId: ConversationIdSchema.parse(`0192f3a0-0000-7000-8000-00000000010${String(n)}`),
    });
    serve({
      ...ONE,
      conversations: { [LEA.id]: { items: [conversation('1')], nextCursor: null } },
      dashboard: { status: 200, body: apiDashboard({ todos: [1, 2, 3, 4, 5].map(todo) }) },
    });
    renderPage();
    const queue = await screen.findByRole('list', { name: 'À traiter' });
    expect(within(queue).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Voir les 2 autres' }));
    expect(within(queue).getAllByRole('listitem')).toHaveLength(5);
  });

  it('says where a conversation opens while none is', async () => {
    serve({ ...ONE, conversations: { [LEA.id]: { items: [conversation('1')], nextCursor: null } } });
    renderPage();
    expect(await screen.findByText(/Choisis une conversation à gauche/u)).toBeDefined();
  });
});

describe('the list of Suivi', () => {
  it('finds a fan by his pseudo, without case nor accents, among the conversations read', async () => {
    serve({
      ...ONE,
      conversations: {
        [LEA.id]: {
          items: [
            conversation('1', { fanDisplayName: 'Jérôme' }),
            conversation('2', { fanDisplayName: 'Max' }),
          ],
          nextCursor: null,
        },
      },
    });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Conversations' });
    const search = screen.getByRole('searchbox', { name: 'Chercher un fan par son pseudo' });
    fireEvent.change(search, { target: { value: 'jero' } });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((row) => row.textContent),
    ).toEqual([expect.stringContaining('Jérôme')]);
    fireEvent.change(search, { target: { value: 'Paul' } });
    expect(screen.getByText('Aucun fan ne porte ce pseudo dans la liste.')).toBeDefined();
  });

  it('puts a whole emoji in the avatar when the pseudo starts with one, in the list and the reader', async () => {
    serve({
      ...ONE,
      conversations: {
        [LEA.id]: { items: [conversation('1', { fanDisplayName: '💋 Max' })], nextCursor: null },
      },
      detail: () => ({ status: 200, body: waiting({ fanDisplayName: '💋 Max' }) }),
    });
    renderPage(OPEN);
    const list = await screen.findByRole('list', { name: 'Conversations' });
    expect(list.querySelector('.nv-avatar')?.textContent).toBe('💋');
    await screen.findByRole('heading', { name: '💋 Max' });
    expect(document.querySelector('.tr-reader__head .nv-avatar')?.textContent).toBe('💋');
  });

  it('says a long wait of « À traiter » in days, as the list does', async () => {
    const [todo] = apiDashboard().todos;
    if (todo === undefined) throw new Error('no todo');
    serve({
      ...ONE,
      conversations: { [LEA.id]: { items: [conversation('1')], nextCursor: null } },
      dashboard: { status: 200, body: apiDashboard({ todos: [{ ...todo, waitingMinutes: 49 * 60 }] }) },
    });
    renderPage();
    const queue = await screen.findByRole('list', { name: 'À traiter' });
    expect(queue.querySelector('.tr-wait')?.textContent).toBe('2 j');
  });
});

describe('the reader of Suivi', () => {
  const withDraft = {
    ...ONE,
    conversations: {
      [LEA.id]: { items: [conversation('1', { state: 'awaiting_approval' })], nextCursor: null },
    },
  };

  it('opens the conversation of a Telegram link, with the draft that waits', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    const draft = await screen.findByRole('region', { name: 'Brouillon à valider' });
    expect(within(draft).getByText('Coucou toi')).toBeDefined();
    expect(screen.getByText('Salut, ça va ?')).toBeDefined();
  });

  it('sends the draft as written on Valider, then reads the conversation again', async () => {
    let approved = false;
    const posted = serve({
      ...withDraft,
      detail: () => ({
        status: 200,
        body: approved ? waiting({ state: 'idle', openDrafts: [] }) : waiting(),
      }),
      command: () => {
        approved = true;
        return { status: 204 };
      },
    });
    renderPage(OPEN);
    const queueReads = (): number =>
      vi.mocked(fetch).mock.calls.filter(([input]) => input === '/v1/dashboard/todos').length;
    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));
    const before = queueReads();
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Brouillon à valider' })).toBeNull();
    });
    expect(posted).toEqual([{ action: 'approve', body: {} }]);
    // « À traiter » is read again at once: the line just decided leaves it.
    await waitFor(() => {
      expect(queueReads()).toBeGreaterThan(before);
    });
  });

  it('sends the retouched bubbles, one per line', async () => {
    const posted = serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Retoucher' }));
    fireEvent.change(screen.getByLabelText('Une bulle par ligne'), {
      target: { value: 'Coucou toi\nTu fais quoi ce soir ?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer la retouche' }));
    await waitFor(() => {
      expect(posted).toEqual([
        { action: 'approve', body: { bubbles: ['Coucou toi', 'Tu fais quoi ce soir ?'] } },
      ]);
    });
  });

  it('keeps the draft and says which guard blocks it when the server refuses it', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      command: () => ({
        status: 422,
        body: {
          error: {
            code: 'draft_unprocessable',
            message: 'x',
            details: { guards: ['meeting_promise'] },
            requestId: 'r',
          },
        },
      }),
    });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ce message ne peut pas partir : une promesse de rencontre. Retouche-le ou refuse-le.',
    );
    expect(screen.getByRole('region', { name: 'Brouillon à valider' })).toBeDefined();
  });

  it('refuses the draft with the reason given', async () => {
    const posted = serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Refuser' }));
    fireEvent.change(screen.getByLabelText(/Pourquoi/u), { target: { value: 'Trop froid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Refuser le brouillon' }));
    await waitFor(() => {
      expect(posted).toEqual([{ action: 'reject', body: { reason: 'Trop froid' } }]);
    });
  });

  it('takes the hand over: a person answers in Reveal from then on', async () => {
    const posted = serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Reprendre la main' }));
    await waitFor(() => {
      expect(posted).toEqual([{ action: 'takeover', body: {} }]);
    });
  });

  it('gives the hand back with what the chatter wants the agent to remember', async () => {
    const posted = serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting({ state: 'human', openDrafts: [] }) }),
    });
    renderPage(OPEN);
    fireEvent.change(await screen.findByLabelText(/Note pour l’agent/u), {
      target: { value: '  Il fête son anniversaire le 12 mars  ' },
    });
    // The button beside the note says it goes with it.
    fireEvent.click(screen.getByRole('button', { name: 'Rendre la main (avec la note)' }));
    await waitFor(() => {
      expect(posted).toEqual([{ action: 'release', body: { note: 'Il fête son anniversaire le 12 mars' } }]);
    });
  });

  it('gives the hand back with no note when none is written', async () => {
    const posted = serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting({ state: 'human', openDrafts: [] }) }),
    });
    renderPage(OPEN);
    expect((await screen.findByLabelText(/Note pour l’agent/u)).getAttribute('maxlength')).toBe('300');
    fireEvent.click(screen.getByRole('button', { name: 'Rendre la main à l’agent' }));
    await waitFor(() => {
      expect(posted).toEqual([{ action: 'release', body: {} }]);
    });
  });

  it('folds the fan’s limits to one line, in amber when one stops the agent', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      flags: { before: { doNotContact: true } },
    });
    renderPage(OPEN);
    const line = await screen.findByText('Ne plus lui écrire', { selector: '.tr-limits__sum' });
    expect(line.className).toContain('tr-warn');
  });

  it('says what she has still to learn about him, in her order, next to his limits', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }), kyc: ['job', 'location'] });
    renderPage(OPEN);
    const line = await screen.findByText('Métier, Localisation');
    expect(line.parentElement?.textContent).toBe('À apprendreMétier, Localisation');
    expect(line.closest('.tr-warn')).toBeNull();
  });

  it('says nothing to learn once every line is learnt, and never asks for a creator', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    await screen.findByText('Limites du fan');
    await waitFor(() => {
      expect(kycCalls()).toHaveLength(1);
    });
    expect(screen.queryByText('À apprendre')).toBeNull();
    cleanup();

    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }), kyc: ['job'] });
    renderPage(OPEN, false);
    await screen.findByText('Limites du fan');
    expect(screen.queryByText('À apprendre')).toBeNull();
    expect(kycCalls()).toHaveLength(0);
  });

  it('says nothing to learn when the server does not answer for it', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }), kyc: 'down' });
    renderPage(OPEN);
    await screen.findByText('Limites du fan');
    await waitFor(() => {
      expect(kycCalls()).toHaveLength(1);
    });
    expect(screen.queryByText('À apprendre')).toBeNull();
    expect(document.querySelector('.tr-learn')).toBeNull();
  });

  it('stays folded when a limit blocks: the amber line says it, the thread comes first', async () => {
    const posted = serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      flags: { before: { doNotContact: true }, after: {} },
    });
    renderPage(OPEN);
    const lift = await screen.findByRole('switch', { name: /Ne plus lui écrire/u });
    const section = lift.closest('details');
    expect(section).toHaveProperty('open', false);
    expect(screen.getByText('Ne plus lui écrire', { selector: '.tr-sheet__sum .tr-warn' })).toBeDefined();
    fireEvent.click(lift);
    expect(await screen.findByText('Aucune', { selector: '.tr-limits__sum' })).toBeDefined();
    expect(posted).toEqual([{ action: 'flags', body: { flag: 'doNotContact', set: false } }]);
  });

  it('freezes sales as a human’s call, and shows the limits the server answers', async () => {
    const posted = serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      flags: { after: { salesFrozen: { reason: 'operator', since: '2026-10-23T10:00:00.000Z' } } },
    });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('switch', { name: /Ventes gelées/u }));
    expect(await screen.findByText('Depuis le 23 octobre : décision d’un humain.')).toBeDefined();
    expect(posted).toEqual([
      { action: 'flags', body: { flag: 'salesFrozen', set: true, freezeReason: 'operator' } },
    ]);
  });

  it('confirms his age in two clicks only', async () => {
    const posted = serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      flags: { after: { ageConfirmedAt: '2026-10-23T10:00:00.000Z' } },
    });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer son âge' }));
    expect(posted).toEqual([]);
    // The button clicked is gone: the keyboard lands on the answer.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Oui, il est majeur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, il est majeur' }));
    expect(await screen.findByText('Majeur, confirmé le 23 octobre.')).toBeDefined();
    expect(posted).toEqual([{ action: 'flags', body: { flag: 'ageConfirmedAt', set: true } }]);
  });

  it('sets a ceiling typed in euros, in cents', async () => {
    const posted = serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Fixer un plafond' }));
    fireEvent.change(screen.getByLabelText('Plafond en euros'), { target: { value: '49,90' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(posted).toEqual([
        { action: 'flags', body: { flag: 'spendingLimitMinor', set: true, limitMinor: 4990 } },
      ]);
    });
  });

  it('keeps the limits as they were and says why when the server refuses', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      command: () => ({ status: 403 }),
    });
    renderPage(OPEN);
    const fragile = await screen.findByRole('switch', { name: /Fan fragile/u });
    fireEvent.click(fragile);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Tu ne peux pas changer les limites de ce fan : rien n’a changé.',
    );
    expect(fragile).toHaveProperty('checked', false);
  });

  it('opens on the draft that waits, not at the top of the thread', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    const draft = await screen.findByRole('region', { name: 'Brouillon à valider' });
    await waitFor(() => {
      expect(scrollIntoView.mock.contexts).toContain(draft.parentElement);
    });
  });

  it('reads the conversation again at once when the draft was decided elsewhere, and says so', async () => {
    let decided = false;
    serve({
      ...withDraft,
      detail: () => ({
        status: 200,
        body: decided ? waiting({ state: 'idle', openDrafts: [] }) : waiting(),
      }),
      command: () => {
        decided = true;
        return {
          status: 409,
          body: { error: { code: 'draft_conflict', message: 'x', details: {}, requestId: 'r' } },
        };
      },
    });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider' }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Brouillon à valider' })).toBeNull();
    });
    expect(screen.getByText(/La conversation a changé entre-temps/u)).toBeDefined();
  });

  it('says why a retouched text cannot be sent, under the field', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Retoucher' }));
    fireEvent.change(screen.getByLabelText('Une bulle par ligne'), {
      target: { value: Array.from({ length: 11 }, (_, i) => `Bulle ${String(i)}`).join('\n') },
    });
    expect(screen.getByText('10 bulles au plus, une par ligne : il y en a 11.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Envoyer la retouche' })).toHaveProperty('disabled', true);
  });

  it('shows what did not leave after a send failed for good, and why', async () => {
    serve({
      ...withDraft,
      detail: () => ({
        status: 200,
        body: waiting({
          state: 'error',
          openDrafts: [],
          failedDraft: {
            id: DRAFT,
            status: 'failed',
            bubbles: ['Coucou toi'],
            finalBubbles: ['Coucou toi, tu es là ?'],
            createdAt: '2026-10-17T20:01:00Z',
          },
        }),
      }),
      events: [
        {
          seq: 4,
          actor: 'system',
          createdAt: '2026-10-17T20:02:00Z',
          type: 'send_failed',
          payload: {
            conversationId: conversation('1').id,
            draftId: DRAFT,
            idempotencyKey: 'k',
            attempt: 1,
            error: 'connector_writes_disabled',
            isFinal: true,
          },
        },
      ],
    });
    renderPage(OPEN);
    expect(await screen.findByText('Coucou toi, tu es là ?')).toBeDefined();
    expect(screen.getByText('N’est pas parti : à envoyer dans Reveal')).toBeDefined();
    expect(
      screen.getByText('L’envoi a échoué, rien n’est parti : l’envoi est désactivé pour ce compte Reveal'),
    ).toBeDefined();
    expect(screen.queryByText('Envoi en cours')).toBeNull();
    // What did not leave, ready to paste in Reveal.
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(screen.getByRole('button', { name: 'Copier le texte' }));
    expect(await screen.findByRole('button', { name: 'Copié' })).toBeDefined();
    expect(writeText).toHaveBeenCalledWith('Coucou toi, tu es là ?');
  });

  it('says a ceiling of 0 € or past 100 000 € cannot be saved, and why', async () => {
    const posted = serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Fixer un plafond' }));
    fireEvent.change(screen.getByLabelText('Plafond en euros'), { target: { value: '0' } });
    expect(screen.getByText(/gèle les ventes/u)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Plafond en euros'), { target: { value: '99999999999' } });
    expect(screen.getByText(/^Au plus 100/u)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
    expect(posted).toEqual([]);
  });

  it('says which media was sent and what it shows, under its price (SUIVI-26)', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      messages: [
        {
          ...FAN_MESSAGE,
          id: '0192f3a0-0000-7000-8000-000000000102',
          direction: 'outbound',
          author: 'human',
          text: '',
          media: [{ kind: 'video', isLocked: true, description: 'Elle danse, lumière tamisée.' }],
          priceMinor: 4990,
          currency: 'EUR',
        },
      ],
    });
    renderPage(OPEN);
    expect(
      await screen.findByText(
        (_, element) => element?.textContent === 'Vidéo · Elle danse, lumière tamisée.',
      ),
    ).toBeDefined();
    expect(screen.queryByText('Média')).toBeNull();
    expect(screen.getByText(/Média payant · 49,90/u)).toBeDefined();
  });

  it('keeps the gap between a text and the media sent with it (SUIVI-26)', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      messages: [
        {
          ...FAN_MESSAGE,
          id: '0192f3a0-0000-7000-8000-000000000103',
          text: 'Regarde ça',
          media: [{ kind: 'image', isLocked: false, description: null }],
        },
      ],
    });
    renderPage(OPEN);
    const text = await screen.findByText('Regarde ça');
    const media = screen.getByText('Photo').closest('.tr-media');
    // The text is an element, so the media after it is not the bubble's first one: `:not(:first-child)` spaces it.
    expect(text.matches('.nv-bubble > .tr-text:first-child')).toBe(true);
    expect(media?.matches('.tr-media:not(:first-child)')).toBe(true);
  });

  it('keeps a disputed age to the owner or a manager, who writes why before confirming (SUIVI-04)', async () => {
    const ageDisputed = { since: '2026-10-22T10:00:00.000Z', by: 'policy' } as const;
    const posted = serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      flags: { before: { ageDisputed }, after: { ageConfirmedAt: '2026-10-23T10:00:00.000Z' } },
      mayConfirmDisputedAge: true,
    });
    renderPage(OPEN);
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmer son âge' }));
    const yes = screen.getByRole('button', { name: 'Oui, il est majeur' });
    expect(yes).toHaveProperty('disabled', true);
    // The button clicked is gone: the keyboard lands on the reason to write.
    expect(document.activeElement).toBe(screen.getByLabelText('Pourquoi tu confirmes son âge'));
    fireEvent.change(screen.getByLabelText('Pourquoi tu confirmes son âge'), {
      target: { value: ' Pièce d’identité vue en appel vidéo ' },
    });
    expect(yes).toHaveProperty('disabled', false);
    fireEvent.click(yes);
    expect(await screen.findByText('Majeur, confirmé le 23 octobre.')).toBeDefined();
    expect(posted).toEqual([
      {
        action: 'flags',
        body: { flag: 'ageConfirmedAt', set: true, reason: 'Pièce d’identité vue en appel vidéo' },
      },
    ]);
  });

  it('tells a chatter who may confirm a disputed age, with nothing to click', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting() }),
      flags: { before: { ageDisputed: { since: '2026-10-22T10:00:00.000Z', by: 'policy' } } },
    });
    renderPage(OPEN);
    expect(
      await screen.findByText(/Seuls le propriétaire et les managers peuvent le confirmer/u),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Confirmer son âge' })).toBeNull();
  });

  it('says the limits are not for this person, without blaming the server nor asking again', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }), flagsRefused: true });
    renderPage(OPEN);
    expect(await screen.findByText('Tu ne peux pas voir ses limites')).toBeDefined();
    expect(screen.queryByText('Le serveur ne répond pas')).toBeNull();
    const flagCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([input]) => typeof input === 'string' && input.includes('/flags?'));
    expect(flagCalls).toHaveLength(1);
  });

  it('reads a disputed age as a suspected minor, in amber, and says confirming lifts the dispute', async () => {
    serve({
      ...withDraft,
      detail: () => ({ status: 200, body: waiting({ state: 'human', openDrafts: [] }) }),
      flags: { before: { ageDisputed: { since: '2026-10-28T10:00:00.000Z', by: 'policy' } } },
      mayConfirmDisputedAge: true,
    });
    renderPage(OPEN);
    expect(await screen.findByText('Âge contesté', { selector: '.tr-sheet__sum .tr-warn' })).toBeDefined();
    expect(screen.getByText('Âge contesté', { selector: '.tr-limit__label' }).className).toContain('tr-warn');
    expect(screen.getByText(/l’agent a relevé un signe de minorité/u)).toBeDefined();
    expect(screen.queryByText(/Pas encore confirmé/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer son âge' }));
    expect(screen.getByText(/Ça lève la contestation/u)).toBeDefined();
  });

  it('says a draft waits for the hand to come back, not for a role, while a human has it', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting({ state: 'human' }) }) });
    renderPage(OPEN);
    expect(
      await screen.findByText('Un humain a la main : rends-la à l’agent pour décider de ce brouillon.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
  });

  it('lets a creator read, never decide', async () => {
    serve({ ...withDraft, detail: () => ({ status: 200, body: waiting() }) });
    renderPage(OPEN, false);
    expect(await screen.findByText('Tu lis seulement : l’équipe décide.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reprendre la main' })).toBeNull();
    // Her fan's limits: read, never changed.
    expect(await screen.findByRole('switch', { name: /Ventes gelées/u })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('button', { name: 'Confirmer son âge' })).toBeNull();
  });

  it('says the server does not answer, in amber, with nothing to click', async () => {
    serve({ ...withDraft, detail: () => ({ status: 503 }) });
    renderPage(OPEN);
    // One retry first (a blip is not an outage), then the reader says so.
    expect(await screen.findByText('Le serveur ne répond pas', undefined, { timeout: 4_000 })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Valider' })).toBeNull();
  });
});

describe('his desire score in Suivi (P3-12)', () => {
  const hot = conversation('1', { fanDisplayName: 'Basile', desire: { score: 82, band: 'hot' } });
  const playful = conversation('2', {
    fanDisplayName: 'Théo',
    updatedAt: '2026-10-17T20:30:00Z',
    desire: { score: 45, band: 'playful' },
  });
  const unscored = conversation('3', { fanDisplayName: 'Noé', updatedAt: '2026-10-17T20:40:00Z' });
  const names = (list: HTMLElement): (string | null | undefined)[] =>
    within(list)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.nv-convo__name')?.textContent);

  it('says the band in a word, never a number, and nothing for a fan with no score yet', async () => {
    serve({ ...ONE, conversations: { [LEA.id]: { items: [hot, unscored], nextCursor: null } } });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Conversations' });
    const [first, second] = within(list).getAllByRole('listitem');
    expect(second?.querySelector('.nv-convo__preview')?.textContent).toBe('Pas encore écrit · chaud');
    expect(second?.textContent).not.toContain('82');
    expect(first?.querySelector('.nv-convo__preview')?.textContent).toBe('Pas encore écrit');
    expect(list.querySelector('[class*="neon"], [class*="danger"], [class*="amber"]')).toBeNull();
  });

  it('keeps the most recent first, and puts the hottest first only when asked, unscored last', async () => {
    serve({ ...ONE, conversations: { [LEA.id]: { items: [hot, playful, unscored], nextCursor: null } } });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Conversations' });
    expect(names(list)).toEqual(['Noé', 'Théo', 'Basile']);
    expect(screen.getByRole('radio', { name: 'Récents' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Chauds d’abord' }));
    expect(names(list)).toEqual(['Basile', 'Théo', 'Noé']);
    expect(window.localStorage.getItem('nirvana.suivi.order')).toBe('hot');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Chauds d’abord' }), { key: 'ArrowLeft' });
    expect(names(list)).toEqual(['Noé', 'Théo', 'Basile']);
  });

  it('keeps « À traiter » above the list whatever the order, and says the order covers the loaded page only', async () => {
    window.localStorage.setItem('nirvana.suivi.order', 'hot');
    serve({
      ...ONE,
      conversations: { [LEA.id]: { items: [hot, playful], nextCursor: 'next' } },
      // The default todo: Kévin, a possible minor, on conversation 1.
      dashboard: { status: 200, body: apiDashboard() },
    });
    renderPage();
    const queue = await screen.findByRole('list', { name: 'À traiter' });
    const list = screen.getByRole('list', { name: 'Conversations' });
    expect(queue.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(names(list)).toEqual(['Basile', 'Théo']);
    expect(
      screen.getByText('Seules les plus récentes sont affichées : le classement ne porte que sur elles.'),
    ).toBeDefined();
  });

  it('offers no order while no fan has a score', async () => {
    serve({ ...ONE, conversations: { [LEA.id]: { items: [unscored], nextCursor: null } } });
    renderPage();
    await screen.findByRole('list', { name: 'Conversations' });
    expect(screen.queryByRole('radiogroup', { name: 'Ordre de la liste' })).toBeNull();
  });

  const reading = (desire: ConversationDetail['desire']): Reply => ({
    status: 200,
    body: ConversationDetailSchema.parse({ ...conversation('1'), desire, openDrafts: [], failedDraft: null }),
  });
  const listed = { [LEA.id]: { items: [conversation('1')], nextCursor: null } };

  it('shows no desire line in the reader before a first score', async () => {
    serve({ ...ONE, conversations: listed, detail: () => reading(null) });
    renderPage(OPEN);
    await screen.findByText('Salut, ça va ?');
    expect(screen.queryByText('Désir')).toBeNull();
  });

  it('shows the band on a neutral gauge, whatever the score', async () => {
    for (const [score, band] of [
      [0, 'neutral'],
      [69, 'playful'],
      [70, 'hot'],
      [100, 'hot'],
    ] as const) {
      serve({ ...ONE, conversations: listed, detail: () => reading({ score, band }) });
      renderPage(OPEN);
      const gauge = await screen.findByRole('meter', { name: 'Note de désir' });
      expect(gauge.getAttribute('aria-valuenow')).toBe(String(score));
      expect(gauge.className).toBe('nv-gauge tr-desire__gauge');
      cleanup();
    }
  });

  it('opens on the curve and says, point by point, what moved it in words', async () => {
    serve({
      ...ONE,
      conversations: listed,
      detail: () => reading({ score: 60, band: 'playful' }),
      desire: {
        status: 200,
        body: {
          points: [
            { at: '2026-10-17T19:00:00Z', before: null, score: 46, signals: ['intent:flirt'] },
            {
              at: '2026-10-17T20:00:00Z',
              before: 46,
              score: 60,
              signals: ['steers_to_intimate', 'long_reply', 'suggestive_emoji', 'suggestive_emoji'],
            },
          ],
        },
      },
    });
    renderPage(OPEN);
    const gauge = await screen.findByRole('meter', { name: 'Note de désir' });
    expect(gauge.getAttribute('aria-valuetext')).toBe('60 sur 100, joueur');
    const sheet = gauge.closest('details');
    if (sheet === null) throw new Error('no desire sheet');
    sheet.open = true;
    fireEvent(sheet, new Event('toggle'));
    const chart = await screen.findByLabelText(/Note de désir au fil de ses messages/u);
    fireEvent.focus(chart);
    const tip = await screen.findByRole('status');
    expect(tip.textContent).toContain('+14');
    expect(tip.textContent).toContain('Il ramène vers l’intime, réponse longue, emoji suggestif ×2');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toContain('Première note : 46');
    expect(screen.getByRole('status').textContent).toContain('Il flirte');
  });

  it('ends the curve on the score the gauge shows, after a silence', async () => {
    serve({
      ...ONE,
      conversations: listed,
      detail: () => reading({ score: 62, band: 'playful' }),
      desire: {
        status: 200,
        body: {
          points: [
            { at: '2026-10-17T19:00:00Z', before: null, score: 46, signals: ['intent:flirt'] },
            { at: '2026-10-17T20:00:00Z', before: 46, score: 78, signals: ['intent:sexting'] },
          ],
        },
      },
    });
    renderPage(OPEN);
    const sheet = (await screen.findByRole('meter', { name: 'Note de désir' })).closest('details');
    if (sheet === null) throw new Error('no desire sheet');
    sheet.open = true;
    fireEvent(sheet, new Event('toggle'));
    const chart = await screen.findByLabelText(/Note de désir au fil de ses messages/u);
    fireEvent.focus(chart);
    const tip = await screen.findByRole('status');
    expect(tip.textContent).toContain('Maintenant');
    expect(tip.textContent).toContain('−16');
    expect(tip.textContent).toContain('Retombée depuis son dernier message : 78 → 62');
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    expect(screen.getByRole('status').textContent).toContain('+32');
    expect(screen.getByRole('status').textContent).toContain('Sexto');
  });

  it('leaves no empty line in the tip of a point with no signal', async () => {
    serve({
      ...ONE,
      conversations: listed,
      detail: () => reading({ score: 20, band: 'neutral' }),
      desire: {
        status: 200,
        body: {
          points: [
            { at: '2026-10-17T19:00:00Z', before: null, score: 10, signals: [] },
            { at: '2026-10-17T20:00:00Z', before: 10, score: 20, signals: ['long_reply'] },
          ],
        },
      },
    });
    renderPage(OPEN);
    const sheet = (await screen.findByRole('meter', { name: 'Note de désir' })).closest('details');
    if (sheet === null) throw new Error('no desire sheet');
    sheet.open = true;
    fireEvent(sheet, new Event('toggle'));
    const chart = await screen.findByLabelText(/Note de désir au fil de ses messages/u);
    fireEvent.focus(chart);
    expect((await screen.findByRole('status')).querySelector('.tr-desire__signals')).not.toBeNull();
    fireEvent.keyDown(chart, { key: 'ArrowLeft' });
    const tip = screen.getByRole('status');
    expect(tip.textContent).toContain('Première note : 10');
    expect(tip.querySelector('.tr-desire__signals')).toBeNull();
  });

  it('says when there is not enough for a curve yet', async () => {
    serve({
      ...ONE,
      conversations: listed,
      detail: () => reading({ score: 46, band: 'playful' }),
      desire: {
        status: 200,
        body: {
          points: [{ at: '2026-10-17T19:00:00Z', before: null, score: 46, signals: ['intent:flirt'] }],
        },
      },
    });
    renderPage(OPEN);
    const sheet = (await screen.findByRole('meter', { name: 'Note de désir' })).closest('details');
    if (sheet === null) throw new Error('no desire sheet');
    sheet.open = true;
    fireEvent(sheet, new Event('toggle'));
    expect(await screen.findByText('Pas encore assez de messages pour une courbe.')).toBeDefined();
  });
});
