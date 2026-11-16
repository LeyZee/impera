// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreatorGameBlock } from './CreatorGameBlock';

/* An invented creator and her case. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const AT = '2026-11-03T10:00:00.000Z';
const item = (kind: string, family: string, earnedAt: string | null) => ({
  kind,
  family,
  earnedAt,
  progress: earnedAt === null ? { current: 0, target: 1, unit: 'once' } : null,
  // Unseen by her: the agency's read never marks it.
  revealedAt: null,
});

function serve(body: unknown, status = 200): { url: string; method: string }[] {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET' });
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
  return calls;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreatorGameBlock creatorId={CREATOR} name="Anna" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('her game on her sheet, agency side (ADR 0107 § 12)', () => {
  it('reads her series with her best, her highest medal and her trophies, and marks nothing seen', async () => {
    const calls = serve({
      items: [
        item('day_streak_7', 'medal', AT),
        item('day_streak_14', 'medal', AT),
        item('day_streak_30', 'medal', null),
        item('first_drop', 'trophy', AT),
        item('perfect_day', 'trophy', null),
      ],
      streaks: [
        { kind: 'day', current: 3, best: 16 },
        { kind: 'delivery', current: 2, best: 2 },
      ],
      level: null,
    });
    show();
    const block = await screen.findByRole('region', { name: 'Jeu' });
    expect(within(block).getByText(/3 jours/u)).toBeDefined();
    expect(within(block).getByText(/meilleure : 16/u)).toBeDefined();
    expect(within(block).getByText('2 de suite')).toBeDefined();
    expect(within(block).getByText('Série de 14 jours')).toBeDefined();
    const trophies = within(block).getByRole('list', { name: 'Trophées gagnés' });
    expect(within(trophies).getAllByRole('listitem')).toHaveLength(1);
    expect(within(trophies).getByText('Premier dépôt')).toBeDefined();
    // Her reveals stay hers; the read is the agency's route, nothing else.
    expect(calls).toEqual([{ url: `/v1/creators/${CREATOR}/trophy-case`, method: 'GET' }]);
  });

  it('says a new creator has nothing yet, without a zero to read as a loss', async () => {
    serve({
      items: [item('day_streak_7', 'medal', null), item('first_drop', 'trophy', null)],
      streaks: [
        { kind: 'day', current: 0, best: 0 },
        { kind: 'delivery', current: 0, best: 0 },
      ],
      level: null,
    });
    show();
    const block = await screen.findByRole('region', { name: 'Jeu' });
    expect(within(block).getAllByText('Aucune')).toHaveLength(2);
    expect(within(block).getByText('Pas encore de médaille')).toBeDefined();
    expect(within(block).getByText('Aucun trophée pour l’instant.')).toBeDefined();
  });

  it('shows nothing when the server refuses the read', async () => {
    const calls = serve({ error: { code: 'forbidden', message: 'x', details: {}, requestId: 'r' } }, 403);
    show();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(screen.queryByRole('region', { name: 'Jeu' })).toBeNull();
  });
});
