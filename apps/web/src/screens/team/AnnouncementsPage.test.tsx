// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnnouncementsPage } from './AnnouncementsPage';

/* Invented team and announcements (ADR 0010). */
const NORA = '0192f3a0-0000-7000-8000-0000000000c1';
const A = '0192f3a0-0000-7000-8000-00000000a001';
const B = '0192f3a0-0000-7000-8000-00000000a002';
const announcement = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  body: 'Réunion inventée lundi',
  creatorId: null,
  creatorName: null,
  authorName: 'Léo',
  mine: false,
  createdAt: '2026-11-03T09:00:00.000Z',
  readAt: null,
  reads: { read: 1, of: 3 },
  ...patch,
});

interface Reply {
  status: number;
  body: unknown;
}

function serve(routes: Record<string, Reply>) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    const reply = routes[`${init?.method ?? 'GET'} ${url}`];
    return Promise.resolve(
      reply === undefined
        ? new Response('null', { status: 404 })
        : new Response(reply.status === 204 ? null : JSON.stringify(reply.body), { status: reply.status }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function show(owner = true): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/equipe/annonces',
    component: () => <AnnouncementsPage owner={owner} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/equipe/annonces'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const CREATORS: Reply = {
  status: 200,
  body: { creators: [{ id: NORA, displayName: 'Nora', timezone: 'Europe/Paris' }] },
};

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
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Équipe › Annonces (EQ-12)', () => {
  it('writes to the members of one creator and shows it first, with nobody having read it yet', async () => {
    const fetcher = serve({
      'GET /v1/creators': CREATORS,
      'GET /v1/team/announcements': { status: 200, body: { announcements: [announcement(A)] } },
      'POST /v1/team/announcements': {
        status: 201,
        body: announcement(B, {
          body: 'Nouveau script inventé',
          creatorId: NORA,
          creatorName: 'Nora',
          authorName: 'Owner',
          mine: true,
          reads: { read: 0, of: 2 },
        }),
      },
    });
    show();
    fireEvent.click(await screen.findByRole('radio', { name: 'Nora' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Annonce' }), {
      target: { value: '  Nouveau script inventé  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    // The textarea's default text holds it too while it is typed: the item's paragraph only.
    const sent = (await screen.findByText('Nouveau script inventé', { selector: 'p' })).closest('li');
    if (sent === null) throw new Error('no item');
    expect(within(sent).getByText('Toi')).toBeDefined();
    expect(within(sent).getByRole('button', { name: 'Pas encore lue · 2 membres' })).toBeDefined();
    const call = fetcher.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(typeof call?.[1]?.body === 'string' ? JSON.parse(call[1].body) : null).toEqual({
      body: 'Nouveau script inventé',
      creatorId: NORA,
    });
    expect(screen.getByRole('textbox', { name: 'Annonce' })).toHaveProperty('value', '');
  });

  it('opens who read it, and withdraws it after a second word', async () => {
    serve({
      'GET /v1/creators': CREATORS,
      'GET /v1/team/announcements': { status: 200, body: { announcements: [announcement(A)] } },
      [`GET /v1/team/announcements/${A}/readers`]: {
        status: 200,
        body: {
          readers: [
            {
              memberId: '0192f3a0-0000-7000-8000-0000000000e1',
              name: 'Théo',
              readAt: '2026-11-03T09:30:00.000Z',
            },
            { memberId: '0192f3a0-0000-7000-8000-0000000000e2', name: 'Lina', readAt: null },
          ],
        },
      },
      [`POST /v1/team/announcements/${A}/withdraw`]: { status: 204, body: null },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Lue par 1 sur 3' }));
    const theo = (await screen.findByText('Théo')).closest('li');
    expect(theo?.textContent.replace(/\s/gu, ' ')).toMatch(/Théolu /u);
    expect(screen.getByText('pas encore')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect(screen.getByText('Elle disparaît d’Aujourd’hui pour tous.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect(await screen.findByText('Aucune annonce pour l’instant.')).toBeDefined();
  });

  it('lets a manager withdraw only his own, and says a refusal in words', async () => {
    serve({
      'GET /v1/creators': CREATORS,
      'GET /v1/team/announcements': {
        status: 200,
        body: { announcements: [announcement(A), announcement(B, { mine: true, body: 'La mienne' })] },
      },
      'POST /v1/team/announcements': {
        status: 403,
        body: {
          error: { code: 'announcement_creator_forbidden', message: 'x', details: {}, requestId: 'r' },
        },
      },
    });
    show(false);
    const mine = (await screen.findByText('La mienne')).closest('li');
    const other = screen.getByText('Réunion inventée lundi').closest('li');
    if (mine === null || other === null) throw new Error('no items');
    expect(within(mine).getByRole('button', { name: 'Retirer' })).toBeDefined();
    expect(within(other).queryByRole('button', { name: 'Retirer' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Annonce' }), { target: { value: 'Hors liste' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Tu n’écris qu’aux membres des créatrices de ta liste.',
    );
  });
});
