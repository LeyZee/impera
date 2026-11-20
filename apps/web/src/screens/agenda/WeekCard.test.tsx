// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WeekCard } from './WeekCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

/* An invented week: two shooting days, the first accepted, and her delivery. */
const MONDAY = '2026-11-23';
const line = (id: string, label: string, done: boolean) => ({
  id: `0192f3a0-0000-7000-8000-00000000040${id}`,
  need: 'feed_shoot',
  label,
  sheet: null,
  count: 1,
  done,
});
const week = (toAccept: boolean) => ({
  week: MONDAY,
  toAccept,
  shootDays: [
    {
      suggestionId: '0192f3a0-0000-7000-8000-000000000301',
      taskId: toAccept ? null : '0192f3a0-0000-7000-8000-000000000501',
      state: toAccept ? 'suggested' : 'accepted',
      day: '2026-11-25',
      items: [line('1', 'Séance feed, tenue claire', true), line('2', 'Vidéo feed', false)],
    },
  ],
  delivery: {
    suggestionId: '0192f3a0-0000-7000-8000-000000000302',
    taskId: null,
    state: toAccept ? 'suggested' : 'accepted',
    dueAt: '2026-11-29T22:00:00.000Z',
    lines: [
      { need: 'feed_shoot', asked: 2, received: 1 },
      { need: 'reveal_story', asked: 7, received: 7 },
    ],
    delivered: false,
  },
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
      <WeekCard monday={MONDAY} zone="Europe/Paris" today="2026-11-24" />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('her week of shooting', () => {
  it('lets her pick the colour of a kind, kept on this device', async () => {
    serve(week(false));
    localStorage.clear();
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Couleurs/ }));
    const row = screen.getByRole('radiogroup', { name: 'Séances boudoir' });
    expect(row.querySelector('[aria-checked="true"]')?.getAttribute('aria-label')).toBe('Rose');
    fireEvent.click(screen.getAllByRole('radio', { name: 'Vert' })[0] ?? row);
    expect(JSON.parse(localStorage.getItem('impera.week-colors') ?? '{}')).toMatchObject({
      feed_shoot: 'vert',
    });
    expect(screen.getByRole('button', { name: 'Remettre nos couleurs' })).toBeTruthy();
  });

  it('shows nothing before the agency sent it', async () => {
    serve({ week: MONDAY, toAccept: false, shootDays: [], delivery: null });
    const { container } = show();
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalled();
    });
    expect(container.textContent).toBe('');
  });

  it('asks her to accept it, its lines not tickable before', async () => {
    const sent = serve(week(true));
    show();
    const accept = await screen.findByRole('button', { name: 'Accepter ma semaine' });
    expect(screen.queryByRole('button', { name: /Cocher/ })).toBeNull();
    expect(screen.getByText(/Tout déposer avant dim\. 29, 23.h/)).toBeTruthy();
    expect(screen.getByText('Prochain tournage')).toBeTruthy();
    expect(screen.getByText('Demain')).toBeTruthy();
    fireEvent.click(accept);
    await waitFor(() => {
      expect(sent).toEqual([
        { method: 'POST', url: '/v1/creator-space/week/accept', body: { week: MONDAY } },
      ]);
    });
  });

  it('ticks a line of an accepted day, and tallies her delivery', async () => {
    const sent = serve(week(false));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Cocher Vidéo feed' }));
    await waitFor(() => {
      expect(sent).toEqual([
        {
          method: 'PUT',
          url: '/v1/creator-space/shoot-items/0192f3a0-0000-7000-8000-000000000402',
          body: { done: true },
        },
      ]);
    });
    expect(screen.getByText('1 / 2', { selector: '.wk-day__count' })).toBeTruthy();
    expect(screen.getByText('7 / 7')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Déposer mes contenus' }).getAttribute('href')).toBe('/contenu');
  });
});
