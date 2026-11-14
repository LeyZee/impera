// @vitest-environment jsdom
import { MarkRevealedBodySchema, type Me, type TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CreatorRewardRevealGate } from './CreatorRewardRevealGate';

import { THEO_ME } from '@/test/pay';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Invented (ADR 0010).
const NORA_ME: Me = {
  ...THEO_ME,
  id: 'creator-user-nora',
  name: 'Nora',
  role: 'creator',
  team: null,
  teamScope: 'self',
  creatorIds: ['00000000-0000-4000-8000-0000000000aa'],
  preferences: { sounds: false },
};

const item = (kind: string, earnedAt: string | null, revealedAt: string | null = null) => ({
  kind,
  family: 'trophy' as const,
  earnedAt,
  progress: null,
  revealedAt,
});

/** Serves her case and takes her reveals; anything else is not there. */
function serve(trophyCase: TrophyCase): { readonly marked: string[][]; readonly urls: string[] } {
  const marked: string[][] = [];
  const urls: string[] = [];
  let current = trophyCase;
  vi.stubGlobal('fetch', (url: string, init?: { method?: string; body?: string }) => {
    urls.push(url);
    if (url === '/v1/creator-space/trophy-case') return Promise.resolve(Response.json(current));
    if (url === '/v1/creator-space/trophy-case/reveals' && init?.body !== undefined) {
      const { kinds } = MarkRevealedBodySchema.parse(JSON.parse(init.body));
      marked.push(kinds);
      current = {
        ...current,
        items: current.items.map((one) =>
          kinds.includes(one.kind) ? { ...one, revealedAt: '2026-11-14T09:00:00Z' } : one,
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
      <CreatorRewardRevealGate user={user} />
    </QueryClientProvider>,
  );

const next = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
};

describe('CreatorRewardRevealGate (ADR 0107 § 11)', () => {
  it('plays three of her reveals in a row at most, the oldest first; the rest wait in her showcase, seen', async () => {
    const { marked } = serve({
      items: [
        item('perfect_day', '2026-11-14T08:05:00Z'),
        item('day_streak_7', '2026-11-14T08:00:00Z'),
        item('first_drop', '2026-11-14T08:01:00Z'),
        item('first_on_time_delivery', '2026-11-14T08:02:00Z'),
        item('first_script', '2026-11-14T08:03:00Z'),
        item('day_streak_14', null),
      ],
      streaks: [
        { kind: 'day', current: 8, best: 8 },
        { kind: 'delivery', current: 1, best: 1 },
      ],
      level: null,
    });
    mount(NORA_ME);
    expect(await screen.findByRole('dialog', { name: 'Série de 7 jours' })).toBeDefined();
    expect(screen.getByRole('img', { name: 'Médaille « Série de 7 jours »' })).toBeDefined();
    next();
    expect(await screen.findByRole('dialog', { name: 'Premier dépôt' })).toBeDefined();
    next();
    expect(await screen.findByRole('dialog', { name: 'Première livraison à l’heure' })).toBeDefined();
    next();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(marked).toEqual([
      ['day_streak_7'],
      ['first_drop'],
      ['first_on_time_delivery', 'first_script', 'perfect_day'],
    ]);
  });

  it('marks a kind it does not draw as seen without a show', async () => {
    const { marked } = serve({
      items: [item('newer_kind', '2026-11-14T08:00:00Z')],
      streaks: [],
      level: null,
    });
    mount(NORA_ME);
    await waitFor(() => {
      expect(marked).toEqual([['newer_kind']]);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('reads nothing for an account that is not a creator', () => {
    const { urls } = serve({ items: [], streaks: [], level: null });
    mount({ ...THEO_ME, preferences: { sounds: false } });
    expect(urls).toEqual([]);
  });
});
