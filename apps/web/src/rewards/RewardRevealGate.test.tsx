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

const mount = (user: Me) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RewardRevealGate user={user} />
    </QueryClientProvider>,
  );

describe('RewardRevealGate (ADR 0104 § 12)', () => {
  it('plays what a chatter is owed, the oldest first, one at a time, and marks each as it closes', async () => {
    const { marked } = serve(CASE);
    mount({ ...THEO_ME, preferences: { sounds: false } });
    expect(await screen.findByRole('dialog', { name: 'Première vente' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(await screen.findByRole('dialog', { name: 'Record du jour' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marked).toEqual([['first_sale'], ['day_record']]);
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

  it('marks a kind it cannot draw as seen without a show, and goes on to the next', async () => {
    const { marked } = serve({
      ...CASE,
      items: [item('creator_only', '2026-11-09T10:00:00Z'), item('first_sale', '2026-11-10T10:00:00Z')],
    });
    mount({ ...THEO_ME, preferences: { sounds: false } });
    expect(await screen.findByRole('dialog', { name: 'Première vente' })).toBeDefined();
    expect(marked).toEqual([['creator_only']]);
  });
});
