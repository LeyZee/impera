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

import { FansPage } from './FansPage';

/* Invented creator and fans: no real person. */
const NORA = '0192f3a0-0000-7000-8000-0000000000c1';
const CONVERSATION = '0192f3a0-0000-7000-8000-0000000000d1';

const fan = (n: number, displayName: string, patch: Record<string, unknown> = {}) => ({
  fanId: `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
  displayName,
  firstSeenAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
  lastMessageAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
  lastPaidAt: null,
  paidPeriod: { eurMinor: 0, usdMinor: 0 },
  paidEver: { eurMinor: 0, usdMinor: 0 },
  holder: 'agent',
  holderName: null,
  conversationId: null,
  unanswered: false,
  states: [],
  ...patch,
});

interface Call {
  readonly path: string;
  readonly query: Record<string, string>;
}

function serve(answer: (call: Call) => { status: number; body?: unknown }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const parsed = new URL(url, 'http://impera.test');
      const call = { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams) };
      calls.push(call);
      const reply =
        call.path === '/v1/creators'
          ? { status: 200, body: { creators: [{ id: NORA, displayName: 'Nora', timezone: 'Europe/Paris' }] } }
          : answer(call);
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const page = (items: unknown[], patch: Record<string, unknown> = {}) => ({
  status: 200,
  body: { items, nextCursor: null, total: items.length, sharedFansKnown: false, ...patch },
});

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/', component: FansPage });
  const suivi = createRoute({ getParentRoute: () => rootRoute, path: '/suivi' });
  const router = createRouter({
    routeTree: rootRoute.addChildren([route, suivi]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const fansOf = (calls: readonly Call[]): Call[] => calls.filter((call) => call.path === '/v1/fans');

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  cleanup();
});

describe('Chatting › Fans (ADR 0124)', () => {
  it('lists her fans with their states in Suivi’s words, what they paid, and a line that opens Suivi', async () => {
    serve(() =>
      page(
        [
          fan(1, 'Élodie', {
            conversationId: CONVERSATION,
            paidEver: { eurMinor: 7000, usdMinor: 0 },
            paidPeriod: { eurMinor: 5000, usdMinor: 0 },
            states: ['care', 'sales_frozen', 'age_disputed'],
          }),
          fan(2, 'Ève', { holder: 'none', lastMessageAt: null }),
        ],
        { total: 2 },
      ),
    );
    renderPage();
    const list = await screen.findByRole('list', { name: 'Fans' });
    const [elodie, eve] = within(list).getAllByRole('listitem');
    expect(screen.getByText('2 fans')).toBeDefined();
    // Two states at most, the urgent first, the rest counted.
    expect(within(elodie ?? list).getByText('Âge contesté')).toBeDefined();
    expect(within(elodie ?? list).getByText('Mode soin')).toBeDefined();
    expect(within(elodie ?? list).getByText('+1')).toBeDefined();
    expect(within(elodie ?? list).getByText(/^70,00\s€$/)).toBeDefined();
    const link = within(elodie ?? list).getByRole('link', { name: /Élodie/ });
    expect(link.getAttribute('href')).toBe(`/suivi?conversation=${CONVERSATION}&creatrice=${NORA}`);
    // No conversation yet: nothing to open, and nothing paid reads « — ».
    expect(within(eve ?? list).queryByRole('link')).toBeNull();
    // What the list cannot hold yet is said once (ADR 0124 § 7, À surveiller).
    expect(screen.getByText(/ne se lisent pas encore/)).toBeDefined();
    // A screen to read: no button acts on a fan.
    expect(within(list).queryAllByRole('button')).toHaveLength(0);
  });

  it('asks the server for each filter, and says plainly when one keeps nobody', async () => {
    const calls = serve((call) => page(call.query['filter'] === 'lapsed' ? [] : [fan(1, 'Dan')]));
    renderPage();
    await screen.findByRole('list', { name: 'Fans' });
    fireEvent.click(screen.getByRole('button', { name: 'Ont décroché (21 j)' }));
    expect(await screen.findByText('Aucun fan n’a décroché.')).toBeDefined();
    expect(fansOf(calls).at(-1)?.query).toMatchObject({ creatorId: NORA, filter: 'lapsed' });
  });

  it('searches on the server, and pages with « Voir la suite »', async () => {
    const calls = serve((call) =>
      call.query['cursor'] === 'next'
        ? page([fan(2, 'Bruno')], { total: 2 })
        : page([fan(1, 'Bruna')], { nextCursor: 'next', total: 2 }),
    );
    renderPage();
    await screen.findByText('Bruna');
    fireEvent.click(screen.getByRole('button', { name: 'Voir la suite' }));
    expect(await screen.findByText('Bruno')).toBeDefined();
    fireEvent.change(screen.getByPlaceholderText('Chercher un fan'), { target: { value: 'brü' } });
    await waitFor(() => {
      expect(fansOf(calls).at(-1)?.query['q']).toBe('brü');
    });
  });

  it('says when the server does not answer, with a way to try again', async () => {
    serve(() => ({ status: 500 }));
    renderPage();
    expect(
      await screen.findByText('Le serveur ne répond pas', undefined, {
        timeout: 3000,
      }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });
});
