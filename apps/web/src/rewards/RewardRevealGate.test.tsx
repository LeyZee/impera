// @vitest-environment jsdom
import { MarkRevealedBodySchema, type Me, type TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RewardRevealGate } from './RewardRevealGate';

import { IRIS_ME, OWNER, THEO_ME } from '@/test/pay';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = (kind: string, earnedAt: string | null, revealedAt: string | null = null) => ({
  kind,
  family: 'trophy' as const,
  earnedAt,
  progress: null,
  revealedAt,
});

const CASE: TrophyCase = {
  items: [
    item('day_record', '2026-11-12T10:00:00Z'),
    item('first_sale', '2026-11-10T10:00:00Z'),
    item('fortnight_record', '2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z'),
    item('streak_5', null),
  ],
  streaks: [{ kind: 'shift', current: 2, best: 2 }],
  level: null,
};

/** Serves the case and takes the reveals; anything else (the period, the settings) is not there. */
function serve(trophyCase: TrophyCase): { readonly marked: string[][]; readonly urls: string[] } {
  const marked: string[][] = [];
  const urls: string[] = [];
  let current = trophyCase;
  vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
    urls.push(url);
    if (url === '/v1/rewards/my-trophy-case') return Promise.resolve(Response.json(current));
    if (url === '/v1/rewards/my-trophy-case/reveals' && init?.body !== undefined) {
      const { kinds } = MarkRevealedBodySchema.parse(JSON.parse(init.body));
      marked.push(kinds);
      current = {
        ...current,
        items: current.items.map((one) =>
          kinds.includes(one.kind) ? { ...one, revealedAt: '2026-11-13T09:00:00Z' } : one,
        ),
      };
      return Promise.resolve(Response.json(current));
    }
    return Promise.resolve(new Response('', { status: 404 }));
  });
  return { marked, urls };
}

const mount = (user: Me, held = false) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RewardRevealGate user={user} held={held} />
    </QueryClientProvider>,
  );

describe('RewardRevealGate (ADR 0104 § 12)', () => {
  it('plays one reveal for everything owed: the most recent of two as high, the other named under it', async () => {
    const { marked } = serve(CASE);
    mount({ ...THEO_ME, preferences: { sounds: false } });
    const dialog = await screen.findByRole('dialog', { name: 'Record du jour' });
    expect(dialog.textContent).toContain('Aussi gagné : Première vente.');
    expect(dialog.querySelectorAll('.rw-reveal__alsoitem')).toHaveLength(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marked).toEqual([['day_record', 'first_sale']]);
  });

  it('gives the ceremony to the highest (rank, medal, trophy, streak) and counts beyond three others', async () => {
    const { marked } = serve({
      ...CASE,
      items: [
        item('streak_5', '2026-11-12T12:00:00Z'),
        item('first_sale', '2026-11-10T10:00:00Z'),
        item('day_record', '2026-11-11T10:00:00Z'),
        item('fortnight_record', '2026-11-12T10:00:00Z'),
        { ...item('tier:2026-11-01:100000', '2026-11-09T10:00:00Z'), family: 'medal' as const },
        { ...item('level:1', '2026-11-08T10:00:00Z'), family: 'level' as const },
      ],
      level: { rank: 1, name: 'Étincelle' },
    });
    mount({ ...THEO_ME, preferences: { sounds: false } });
    const dialog = await screen.findByRole('dialog', { name: 'Étincelle' });
    expect([...dialog.querySelectorAll('.rw-reveal__alsoname')].map((one) => one.textContent)).toEqual([
      'Palier atteint',
      'Record de quinzaine',
      'Record du jour',
      'autres',
    ]);
    expect(dialog.querySelector('[data-more]')?.textContent).toBe('+2');
    expect(dialog.textContent).toContain(
      'Aussi gagné : Palier atteint, Record de quinzaine, Record du jour et 2 autres.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marked).toHaveLength(1);
    expect(marked[0]?.[0]).toBe('level:1');
    expect(marked[0]).toHaveLength(6);
  });

  it('plays several ranks owed at once as one, the highest, and marks the ones under it with it', async () => {
    const level = (rank: number, earnedAt: string) => ({
      ...item(`level:${String(rank)}`, earnedAt),
      family: 'level' as const,
    });
    const { marked } = serve({
      ...CASE,
      items: [
        item('first_sale', '2026-11-10T10:00:00Z'),
        level(1, '2026-11-12T10:00:00Z'),
        level(2, '2026-11-12T10:00:01Z'),
        level(3, '2026-11-12T10:00:02Z'),
      ],
      level: { rank: 3, name: 'Charmeur' },
    });
    mount({ ...THEO_ME, preferences: { sounds: false } });
    const dialog = await screen.findByRole('dialog', { name: 'Charmeur' });
    // The ranks passed on the way are not named beside it; the trophy is.
    expect([...dialog.querySelectorAll('.rw-reveal__alsoname')].map((one) => one.textContent)).toEqual([
      'Première vente',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marked).toEqual([['level:3', 'first_sale', 'level:1', 'level:2']]);
  });

  it('waits while his shift is to take or under way, and marks nothing as seen (recette 27/11, G10)', async () => {
    const { marked, urls } = serve(CASE);
    mount({ ...THEO_ME, preferences: { sounds: false } }, true);
    await waitFor(() => {
      expect(urls).toContain('/v1/rewards/my-trophy-case');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(marked).toEqual([]);
  });

  it('shows nothing when every gain was already revealed, or none is earned', async () => {
    const { urls } = serve({
      ...CASE,
      items: [item('fortnight_record', '2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z')],
    });
    mount(THEO_ME);
    await waitFor(() => {
      expect(urls).toContain('/v1/rewards/my-trophy-case');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks nothing and shows nothing for those who do not play', async () => {
    const { urls } = serve(CASE);
    for (const user of [OWNER, IRIS_ME]) {
      mount(user);
      await Promise.resolve();
      expect(screen.queryByRole('dialog')).toBeNull();
      cleanup();
    }
    expect(urls.filter((url) => url.startsWith('/v1/rewards'))).toEqual([]);
  });

  it('marks a kind it cannot draw as seen without a show: with what is shown, or alone at once', async () => {
    const { marked } = serve({
      ...CASE,
      items: [item('creator_only', '2026-11-09T10:00:00Z'), item('first_sale', '2026-11-10T10:00:00Z')],
    });
    mount({ ...THEO_ME, preferences: { sounds: false } });
    const dialog = await screen.findByRole('dialog', { name: 'Première vente' });
    expect(dialog.querySelector('.rw-reveal__also')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => {
      expect(marked).toEqual([['first_sale', 'creator_only']]);
    });
    cleanup();
    const alone = serve({ ...CASE, items: [item('creator_only', '2026-11-09T10:00:00Z')] });
    mount({ ...THEO_ME, preferences: { sounds: false } });
    await waitFor(() => {
      expect(alone.marked).toEqual([['creator_only']]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
