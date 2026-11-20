// @vitest-environment jsdom
import { CreatorIdSchema, ValidateCreatorWeekBodySchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WeekPlanPanel } from './WeekPlanPanel';

/* An invented creator and her computed week. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const MONDAY = '2026-11-23';
const item = (label: string, minutes: number) => ({
  need: 'feed_shoot',
  label,
  sheet: null,
  minutes,
  count: 1,
  requestId: null,
});
const computed = {
  week: MONDAY,
  state: 'draft',
  plan: {
    shootDays: [
      { day: '2026-11-25', items: [item('Séance A', 200), item('Séance B', 90)] },
      { day: '2026-11-28', items: [item('Vidéo A', 30)] },
    ],
    deferred: [],
    dueAt: '2026-11-29T22:00:00.000Z',
    stock: { sessions: 1, videos: 0, stories: 2 },
    capacityMinutes: 240,
  },
  computedAt: '2026-11-22T17:50:00.000Z',
  validatedAt: null,
};

function serve(read: unknown, status = 200): unknown[] {
  const posts: unknown[] = [];
  let answer = read;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        posts.push(body);
        const { plan } = ValidateCreatorWeekBodySchema.parse(body);
        // Validated: read again, the week is as it left.
        answer = { ...computed, plan, state: 'validated', validatedAt: '2026-11-22T19:00:00.000Z' };
        return Promise.resolve(new Response(JSON.stringify(answer)));
      }
      return Promise.resolve(new Response(JSON.stringify(answer), { status }));
    }),
  );
  return posts;
}

const show = (canValidate: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <WeekPlanPanel
        creatorId={CREATOR}
        creatorName="Lune"
        timezone="Europe/Paris"
        week={MONDAY}
        canValidate={canValidate}
      />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('her week, as the owner reads it', () => {
  it('says when it is not computed yet', async () => {
    serve({ error: { code: 'creator_week_not_found', message: 'x' } }, 404);
    show(true);
    expect(await screen.findByText(/Pas encore préparée/)).toBeTruthy();
  });

  it('warns amber over a day’s capacity, and sends the week as corrected', async () => {
    const posts = serve(computed);
    show(true);
    expect(await screen.findByText(/Plus que ce qu’une journée tient/)).toBeTruthy();
    const [, saturday] = screen.getAllByRole('button', { name: 'Retirer ce jour' });
    if (saturday === undefined) throw new Error('two days expected');
    fireEvent.click(saturday);
    expect(screen.getByText('Reporté à la semaine suivante')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Remettre/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Valider et envoyer' }));
    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });
    const { plan } = ValidateCreatorWeekBodySchema.parse(posts[0]);
    expect(plan.shootDays.map((day) => day.day)).toEqual(['2026-11-25']);
    expect(plan.shootDays.flatMap((day) => day.items.map((one) => one.label))).toEqual([
      'Séance A',
      'Séance B',
      'Vidéo A',
    ]);
    expect(await screen.findByText('Validée')).toBeTruthy();
  });

  it('moves a line through its compact menu, to the week after, and puts it back', async () => {
    serve(computed);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Déplacer Vidéo A' }));
    expect(screen.getByRole('menuitem', { name: 'Vers Mercredi 25 novembre' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'À la semaine suivante' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByText('Reporté à la semaine suivante')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remettre Vidéo A' }));
    expect(screen.queryByText('Reporté à la semaine suivante')).toBeNull();
  });

  it('lets a manager read it, never validate it', async () => {
    serve(computed);
    show(false);
    expect(await screen.findByText('Seul le propriétaire valide la semaine.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Valider et envoyer' })).toBeNull();
  });
});
