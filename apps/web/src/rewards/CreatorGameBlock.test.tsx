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
    // Two series side by side, said alike; no-break spaces around the dot and before the colon.
    const facts = within(block)
      .getAllByRole('definition')
      .map((fact) => fact.textContent);
    expect(facts).toEqual(['3\u00a0·\u00a0meilleure\u00a0: 16', '2', 'Série de 14 jours']);
    expect(within(block).getByText('Jours de routine d’affilée')).toBeDefined();
    expect(within(block).getByText('Livraisons à l’heure d’affilée')).toBeDefined();
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
    // An empty fact weighs less than a value, and every one says it the same way (avis Design, 16/11).
    const empties = within(block).getAllByText(/^Aucune? pour l’instant$/u);
    expect(empties.map((one) => one.textContent)).toEqual([
      'Aucun pour l’instant',
      'Aucune pour l’instant',
      'Aucune pour l’instant',
      'Aucun pour l’instant',
    ]);
    expect(empties.every((one) => one.className === 'rw-member__empty')).toBe(true);
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
