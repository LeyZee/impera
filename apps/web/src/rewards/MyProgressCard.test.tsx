// @vitest-environment jsdom
import type { Me, TrophyCase } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyProgressCard } from './MyProgressCard';

import { OWNER, THEO_ME } from '@/test/pay';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// jsdom has no matchMedia: « Réduire les animations » is on, so the bar and its figure are in place at once.
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const NOTHING: TrophyCase = { items: [], streaks: [], level: null, nextLevel: null };

function show(user: Me, trophyCase: TrophyCase): { readonly urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    urls.push(url);
    return Promise.resolve(
      url === '/v1/rewards/my-trophy-case' ? Response.json(trophyCase) : new Response(null, { status: 404 }),
    );
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MyProgressCard user={user} />
    </QueryClientProvider>,
  );
  return { urls };
}

describe('MyProgressCard', () => {
  it('says his rank, the way to the next one and his series, and leads to his trophies', async () => {
    show(THEO_ME, {
      ...NOTHING,
      streaks: [{ kind: 'shift', current: 4, best: 9 }],
      level: { rank: 2, name: 'Confirmé' },
      nextLevel: { rank: 3, name: 'Expert', thresholdMinor: 400_000, currentMinor: 100_000, currency: 'EUR' },
    });
    expect(await screen.findByText('Confirmé')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir mes trophées' }).getAttribute('href')).toBe(
      '/moi/trophees',
    );
    expect(screen.getByText('Expert')).toBeTruthy();
    expect(screen.getByText('4 shifts')).toBeTruthy();
    expect(screen.getByText('· record 9')).toBeTruthy();
    expect(document.querySelector('.rw-quest__head .rw-quest__go')).not.toBeNull();
    const gauge = screen.getByRole('progressbar', { name: 'Avancée vers le rang Expert' });
    expect(gauge.getAttribute('aria-valuenow')).toBe('25');
    expect(document.querySelector('.rw-quest__percent')?.textContent).toBe('25 %');
    // No amount on this card: they are his rank card's and his trophies'.
    expect(document.body.textContent).not.toMatch(/€/u);
  });

  it('says « Pas encore de rang » before the first one, and one shift in the singular', async () => {
    show(THEO_ME, {
      ...NOTHING,
      streaks: [{ kind: 'shift', current: 1, best: 1 }],
      nextLevel: { rank: 1, name: 'Recrue', thresholdMinor: 100_000, currentMinor: 0, currency: 'EUR' },
    });
    expect(await screen.findByText('Pas encore de rang')).toBeTruthy();
    expect(screen.getByText('Recrue')).toBeTruthy();
    expect(screen.getByText('1 shift')).toBeTruthy();
  });

  it('shows the series alone when the owner set no rank', async () => {
    show(THEO_ME, { ...NOTHING, streaks: [{ kind: 'shift', current: 3, best: 3 }] });
    expect(await screen.findByText('3 shifts')).toBeTruthy();
    expect(screen.queryByText('Pas encore de rang')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('lists the goals within reach, the nearest first, with what is left', async () => {
    show(THEO_ME, {
      ...NOTHING,
      items: [
        {
          kind: 'streak_10',
          family: 'streak',
          earnedAt: null,
          revealedAt: null,
          progress: { current: 4, target: 10, unit: 'shift' },
        },
        {
          kind: 'streak_5',
          family: 'streak',
          earnedAt: null,
          revealedAt: null,
          progress: { current: 4, target: 5, unit: 'shift' },
        },
      ],
    });
    expect(await screen.findByText('À ta portée')).toBeTruthy();
    const names = [...document.querySelectorAll('.rw-quest__goal-what')].map((one) => one.textContent);
    expect(names).toEqual(['Série de 5', 'Série de 10']);
    expect(screen.getByText('Encore 1 shift')).toBeTruthy();
    expect(screen.getByText('Presque')).toBeTruthy();
    expect(screen.getByText('Encore 6 shifts')).toBeTruthy();
    // Neither rank nor series: no empty head, « Mes trophées » beside « Ma progression » (CHAT-11).
    expect(document.querySelector('.rw-quest__head')).toBeNull();
    expect(document.querySelector('.nv-panel__head .rw-quest__go')?.textContent).toBe('Mes trophées');
  });

  it('says what was gained since the last visit, and nothing on a first one', async () => {
    const next = {
      rank: 3,
      name: 'Expert',
      thresholdMinor: 400_000,
      currentMinor: 200_000,
      currency: 'EUR' as const,
    };
    show(THEO_ME, { ...NOTHING, level: { rank: 2, name: 'Confirmé' }, nextLevel: next });
    await screen.findByText('Confirmé');
    expect(screen.queryByText(/depuis ta dernière visite/u)).toBeNull();
    cleanup();
    show(THEO_ME, {
      ...NOTHING,
      level: { rank: 2, name: 'Confirmé' },
      nextLevel: { ...next, currentMinor: 260_000 },
    });
    expect(await screen.findByText(/\+15\s% depuis ta dernière visite/u)).toBeTruthy();
  });

  it('shows nothing with no rank and no series under way', async () => {
    const { urls } = show(THEO_ME, { ...NOTHING, streaks: [{ kind: 'shift', current: 0, best: 6 }] });
    await waitFor(() => {
      expect(urls).toContain('/v1/rewards/my-trophy-case');
    });
    await Promise.resolve();
    expect(screen.queryByText('Ma progression')).toBeNull();
  });

  it('asks nothing and shows nothing for who does not play', () => {
    const { urls } = show(OWNER, NOTHING);
    expect(urls).toEqual([]);
    expect(screen.queryByText('Ma progression')).toBeNull();
  });
});
