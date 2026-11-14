// @vitest-environment jsdom
import type { Me, TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RewardOwedNotice } from './RewardOwedNotice';

import { OWNER, THEO_ME } from '@/test/pay';

const owing = (count: number): TrophyCase => ({
  items: ['first_sale', 'day_record'].slice(0, count).map((kind) => ({
    kind,
    family: 'trophy',
    earnedAt: '2026-11-12T10:00:00.000Z',
    progress: null,
    revealedAt: null,
  })),
  streaks: [],
  level: null,
});

function renderAt(pathname: string, trophyCase: TrophyCase, user: Me = THEO_ME): void {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(JSON.stringify(trophyCase), { status: 200 })));
  const root = createRootRoute({ component: () => <RewardOwedNotice user={user} pathname={pathname} /> });
  const router = createRouter({
    routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '$' })]),
    history: createMemoryHistory({ initialEntries: [pathname] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('RewardOwedNotice', () => {
  it('says a gain waits on a conversation, and « Voir » leads to Aujourd’hui where it plays', async () => {
    renderAt('/suivi', owing(1));
    expect(await screen.findByText('Un gain t’attend.')).toBeTruthy();
    expect((await screen.findByRole('link', { name: 'Voir' })).getAttribute('href')).toBe('/aujourdhui');
    expect(document.querySelector('.rw-reveal')).toBeNull();
  });

  it('counts several gains', async () => {
    renderAt('/commissions/factures', owing(2));
    expect(await screen.findByText('2 gains t’attendent.')).toBeTruthy();
  });

  it('stays silent where the reveal plays, when nothing is owed, and for who does not play', async () => {
    for (const [pathname, trophyCase, user] of [
      ['/aujourdhui', owing(1), THEO_ME],
      ['/commissions', owing(1), THEO_ME],
      ['/suivi', owing(0), THEO_ME],
      ['/suivi', owing(1), OWNER],
    ] as const) {
      renderAt(pathname, trophyCase, user);
      const region = await screen.findByRole('status');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(region.textContent).toBe('');
      cleanup();
    }
  });
});
