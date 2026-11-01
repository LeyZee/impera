// @vitest-environment jsdom
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

import { AlertHistoryPage } from './AlertHistoryPage';

/* Invented creators and fans: no real person. */
const NORA = '0192f3a0-0000-7000-8000-0000000000c1';
const LEA = '0192f3a0-0000-7000-8000-0000000000c2';
const GROUP = '0192f3a0-0000-7000-8000-0000000000a1';
const CREATORS = [
  { id: NORA, displayName: 'Nora Vidal', timezone: 'Europe/Paris' },
  { id: LEA, displayName: 'Léa', timezone: 'Europe/Paris' },
];

const at = (minutesAgo: number): string => new Date(Date.now() - minutesAgo * 60_000).toISOString();

const trigger = (n: number, creatorId: string, minutesAgo: number, patch: Record<string, unknown> = {}) => ({
  id: `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
  creatorId,
  conversationId: `0192f3a0-0000-7000-8000-0000000000d${String(n)}`,
  fanId: '0192f3a0-0000-7000-8000-0000000000f1',
  fanDisplayName: 'Théo',
  trigger: { alert: { kind: 'system', code: 'service_request' }, matchedBy: 'rule' },
  alertGroupId: null,
  alertName: 'Demande de service',
  pausedAgent: false,
  reason: 'Le fan demande un service (contenu sur mesure, appel, cam ou vocal).',
  at: at(minutesAgo),
  seenAt: null,
  ...patch,
});

const VIDEO = {
  trigger: {
    alert: { kind: 'custom', id: '0192f3a0-0000-7000-8000-0000000000b1' },
    matchedBy: 'keyword',
    keyword: 'vidéo perso',
  },
  alertGroupId: GROUP,
  alertName: 'Vidéo perso',
  pausedAgent: true,
  reason: 'Le fan a écrit « vidéo perso », un mot de l’alerte « Vidéo perso ».',
  fanDisplayName: 'Basile',
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

interface Call {
  readonly method: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly body: unknown;
}

/** A fake server: each call answered by `answer`, every call kept in order. */
function serve(answer: (call: Call) => Reply | undefined): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url, 'http://nirvana.test');
      const call: Call = {
        method: init?.method ?? 'GET',
        path: parsed.pathname,
        query: Object.fromEntries(parsed.searchParams),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      const reply = (call.method === 'GET' && call.path === '/v1/creators'
        ? { status: 200, body: { creators: CREATORS } }
        : answer(call)) ?? { status: 500 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const page = (items: unknown[], nextCursor: string | null = null): Reply => ({
  status: 200,
  body: { items, nextCursor },
});

/** Nora: a service asked 5 min ago, and « Vidéo perso » 2 h ago, seen; Léa: « Vidéo perso » 30 min ago. */
const HISTORY: Readonly<Record<string, unknown[]>> = {
  [NORA]: [trigger(1, NORA, 5), trigger(2, NORA, 120, { ...VIDEO, seenAt: at(60) })],
  [LEA]: [trigger(3, LEA, 30, VIDEO)],
};

const history = (call: Call): Reply | undefined =>
  call.method === 'GET' && call.path === '/v1/alerts/triggers'
    ? page(HISTORY[call.query['creatorId'] ?? ''] ?? [])
    : undefined;

const triggerReads = (calls: readonly Call[]): Call[] =>
  calls.filter((call) => call.method === 'GET' && call.path === '/v1/alerts/triggers');

function renderPage(onSelect: (id: string | null) => void = vi.fn()): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <AlertHistoryPage selected={null} onSelect={onSelect} canDecide isOwner={false} nav={null} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const lines = async (): Promise<HTMLElement[]> =>
  within(await screen.findByRole('list', { name: 'Alertes' })).getAllByRole('listitem');

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Suivi › Historique des alertes (P4-01)', () => {
  it('lists every creator’s alerts newest first, with the line the server wrote, the fan and the creator', async () => {
    serve(history);
    renderPage();
    const [first, second, third] = await lines();
    expect(first?.textContent).toContain('Demande de service');
    // A system alert matched without a word: its line would only repeat its name.
    expect(first?.textContent).not.toContain('Le fan demande un service');
    expect(first?.textContent).toContain('Théo · Nora Vidal');
    expect(first?.textContent).toContain('il y a 5 min');
    expect(second?.textContent).toContain('Vidéo perso');
    expect(second?.textContent).toContain('Agent en pause');
    expect(second?.textContent).toContain('Le fan a écrit « vidéo perso »');
    expect(second?.textContent).toContain('Basile · Léa');
    // Seen: said so, without a button.
    expect(third?.textContent).toContain('Vu');
    expect(within(third ?? document.body).queryByRole('button', { name: /Marquer comme vu/ })).toBeNull();
    // Nothing here counts in red: no number, no alarm.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('leads to « À traiter » from its intro, and says where a conversation opens', async () => {
    serve(history);
    renderPage();
    await lines();
    expect(screen.getByRole('link', { name: '«\u00a0À traiter\u00a0»' }).getAttribute('href')).toBe('/suivi');
    expect(screen.getByText(/Choisis une alerte à gauche/u)).toBeDefined();
  });

  it('opens the conversation of a line beside the list', async () => {
    serve(history);
    const onSelect = vi.fn();
    renderPage(onSelect);
    const [first] = await lines();
    const [open] = within(first ?? document.body).getAllByRole('button');
    fireEvent.click(open ?? document.body);
    expect(onSelect).toHaveBeenCalledWith('0192f3a0-0000-7000-8000-0000000000d1');
  });

  it('marks one line seen for the agency, then reads the history again', async () => {
    const calls = serve((call) =>
      call.method === 'POST' && call.path.endsWith('/seen') ? { status: 204 } : history(call),
    );
    renderPage();
    const [first] = await lines();
    const before = triggerReads(calls).length;
    fireEvent.click(within(first ?? document.body).getByRole('button', { name: /Marquer comme vu/ }));
    await waitFor(() => {
      expect(triggerReads(calls).length).toBeGreaterThan(before);
    });
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({
      path: '/v1/alerts/triggers/0192f3a0-0000-7000-8000-000000000001/seen',
      query: { creatorId: NORA },
    });
  });

  it('marks all seen, creator by creator, up to the newest line of each, under the alert filter', async () => {
    const calls = serve((call) => {
      if (call.method === 'POST' && call.path === '/v1/alerts/triggers/seen') {
        return { status: 200, body: { marked: 1 } };
      }
      return history(call);
    });
    renderPage();
    await lines();
    fireEvent.change(screen.getByRole('combobox', { name: 'Alerte' }), { target: { value: GROUP } });
    await waitFor(() => {
      expect(triggerReads(calls).some((call) => call.query['alert'] === GROUP)).toBe(true);
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Tout marquer comme vu' }));
    expect((await screen.findByRole('status')).textContent).toBe('2 alertes marquées comme vues.');
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([
      { creatorId: NORA, untilId: '0192f3a0-0000-7000-8000-000000000001', alert: GROUP },
      { creatorId: LEA, untilId: '0192f3a0-0000-7000-8000-000000000003', alert: GROUP },
    ]);
  });

  it('waits for the lines of a new alert filter before « Tout marquer comme vu »', async () => {
    const calls = serve(history);
    renderPage();
    await lines();
    // The new filter's pages never answer: the lines shown stay the old filter's.
    const fetch = vi.fn((url: string) =>
      new URL(url, 'http://nirvana.test').searchParams.get('alert') === GROUP
        ? new Promise<Response>(() => undefined)
        : Promise.resolve(new Response(null, { status: 500 })),
    );
    vi.stubGlobal('fetch', fetch);
    fireEvent.change(screen.getByRole('combobox', { name: 'Alerte' }), { target: { value: GROUP } });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: 'Tout marquer comme vu' })).toHaveProperty('disabled', true);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('keeps the unseen ones or one alert as the server reads them, and one creator’s lines', async () => {
    const calls = serve(history);
    renderPage();
    await lines();
    fireEvent.click(screen.getByRole('button', { name: 'Non vues' }));
    await waitFor(() => {
      expect(triggerReads(calls).filter((call) => call.query['seen'] === 'false')).toHaveLength(2);
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Alerte' }), {
      target: { value: 'identity_doubt' },
    });
    await waitFor(() => {
      expect(triggerReads(calls).some((call) => call.query['alert'] === 'identity_doubt')).toBe(true);
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Créatrice' }), { target: { value: LEA } });
    await waitFor(async () => {
      expect(await lines()).toHaveLength(1);
    });
    expect((await lines())[0]?.textContent).toContain('Léa');
  });

  it('offers her alert in the filter once it has rung, and keeps it once the list narrows', async () => {
    serve(history);
    renderPage();
    await lines();
    const filter = screen.getByRole('combobox', { name: 'Alerte' });
    expect(within(filter).getByRole('option', { name: 'Vidéo perso' })).toBeTruthy();
    fireEvent.change(filter, { target: { value: 'keyword' } });
    expect(within(filter).getByRole('option', { name: 'Vidéo perso' })).toBeTruthy();
  });

  it('reads the next page of a creator on « Voir plus », from her cursor', async () => {
    const calls = serve((call) => {
      if (call.method !== 'GET' || call.path !== '/v1/alerts/triggers') return undefined;
      if (call.query['creatorId'] === LEA) return page([]);
      return call.query['cursor'] === 'p2'
        ? page([trigger(4, NORA, 300)])
        : page([trigger(1, NORA, 5)], 'p2');
    });
    renderPage();
    expect(await lines()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Voir plus' }));
    await waitFor(async () => {
      expect(await lines()).toHaveLength(2);
    });
    expect(triggerReads(calls).some((call) => call.query['cursor'] === 'p2')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Voir plus' })).toBeNull();
  });

  it('never says nothing rang while the first read of her alerts has not answered', async () => {
    // Creators answer at once; their alerts never do.
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('/v1/creators')
          ? Promise.resolve(new Response(JSON.stringify({ creators: CREATORS }), { status: 200 }))
          : new Promise<Response>(() => undefined),
      ),
    );
    renderPage();
    await screen.findByRole('group', { name: 'Filtres' });
    expect(screen.queryByText(/Aucune alerte n’a encore sonné/)).toBeNull();
  });

  it('says when nothing rang yet, and when the server does not answer', async () => {
    serve((call) => (call.path === '/v1/alerts/triggers' ? page([]) : undefined));
    renderPage();
    expect(await screen.findByText(/Aucune alerte n’a encore sonné/)).toBeTruthy();
    cleanup();

    serve(() => ({ status: 500 }));
    renderPage();
    expect(await screen.findByText('Le serveur ne répond pas. Réessaie dans un instant.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });
});
