// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DayCard } from './DayCard';
import { doneAfterTap, firstSentence } from './day-model';
import { forgetColors } from './week-colors';

/* An invented day: what the server answers, the essentials first. */
const TODAY = '2026-11-24';
const line = (
  item: string,
  platform: string,
  label: string,
  target: number,
  done: number,
  essential: boolean,
) => ({
  item,
  platform,
  label,
  sheet: `${label} : une phrase. Une autre.`,
  target,
  done,
  essential,
});
const day = (essentialsDone: boolean) => ({
  day: TODAY,
  today: TODAY,
  lines: [
    line('reveal_story', 'reveal', 'Ta story Reveal', 1, essentialsDone ? 1 : 0, true),
    line('reveal_video', 'reveal', 'Ta vidéo du jour sur Reveal', 1, 1, true),
    line('insta_cta_story', 'instagram', 'Ta story qui mène à Reveal', 1, essentialsDone ? 1 : 0, true),
    line('insta_stories', 'instagram', '3 autres stories Instagram', 3, 1, false),
    line('insta_posts', 'instagram', '2 posts Instagram', 2, 0, false),
    line('telegram_posts', 'telegram', '2 posts écrits sur Telegram', 2, 0, false),
  ],
});

function serve(read: unknown): { method: string; url: string; body: unknown }[] {
  const sent: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method !== undefined && init.method !== 'GET') {
        sent.push({
          method: init.method,
          url,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(JSON.stringify(read), { status: 200 }));
    }),
  );
  return sent;
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DayCard />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  forgetColors();
});

describe('her day', () => {
  it('leads with the essentials of the day, then the bonus by network', async () => {
    serve(day(false));
    show();
    const lead = await screen.findByRole('region', { name: 'L’essentiel du jour' });
    expect(
      within(lead)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      expect.stringContaining('Ta story Reveal'),
      expect.stringContaining('Ta vidéo du jour sur Reveal'),
      expect.stringContaining('Ta story qui mène à Reveal'),
    ]);
    expect(within(lead).getByLabelText('1 sur 3 faits')).toBeTruthy();
    expect(screen.getByText('En bonus')).toBeTruthy();
    expect(screen.getByText('Instagram')).toBeTruthy();
    expect(screen.getByText('Telegram')).toBeTruthy();
    expect(screen.queryByText(/L’essentiel est fait/)).toBeNull();
  });

  it('says when the essentials are done, and the rest is a bonus', async () => {
    serve(day(true));
    show();
    expect(await screen.findByText(/L’essentiel est fait/)).toBeTruthy();
  });

  it('ticks a line of one, and a line of several up to the mark she taps', async () => {
    const sent = serve(day(false));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Cocher Ta story qui mène à Reveal' }));
    await waitFor(() => {
      expect(sent).toEqual([
        { method: 'PUT', url: `/v1/creator-space/day/${TODAY}/items/insta_cta_story`, body: { done: 1 } },
      ]);
    });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '2 posts Instagram : 2 sur 2' }).hasAttribute('disabled'),
      ).toBe(false);
    });
    fireEvent.click(screen.getByRole('button', { name: '2 posts Instagram : 2 sur 2' }));
    await waitFor(() => {
      expect(sent.at(-1)).toEqual({
        method: 'PUT',
        url: `/v1/creator-space/day/${TODAY}/items/insta_posts`,
        body: { done: 2 },
      });
    });
  });

  it('shows nothing when her day asks nothing', async () => {
    serve({ day: TODAY, today: TODAY, lines: [] });
    const { container } = show();
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });
});

describe('her day, in a few rules', () => {
  it('counts up to the mark she taps, one less when she taps her last one again', () => {
    expect(doneAfterTap(0, 0)).toBe(1);
    expect(doneAfterTap(1, 2)).toBe(3);
    expect(doneAfterTap(3, 2)).toBe(2);
    expect(doneAfterTap(1, 0)).toBe(0);
  });

  it('shows the first sentence of a sheet before she opens it', () => {
    expect(firstSentence('La plus importante : c’est elle. Rien d’osé.')).toBe('La plus importante');
    expect(firstSentence('Un Reel court, pour tester une idée. On garde ce qui marche.')).toBe(
      'Un Reel court, pour tester une idée.',
    );
    expect(firstSentence('Sans point')).toBe('Sans point');
  });
});
