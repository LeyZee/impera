// @vitest-environment jsdom
import { CreateSuggestionBodySchema, CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgendaSection } from './AgendaSection';

/* An invented creator and suggestions. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const declined = {
  id: '0192f3a0-0000-7000-8000-000000000201',
  week: '2026-11-02',
  when: { kind: 'day', day: '2026-11-07' },
  minutes: null,
  category: 'appointment',
  title: 'Séance photo',
  purpose: null,
  essential: false,
  origin: 'agency',
  state: 'declined',
  reason: 'Pas ce samedi',
  decidedAt: '2026-11-02T11:00:00.000Z',
  createdAt: '2026-11-02T09:00:00.000Z',
  task: null,
};

/** A fake `/v1/creators/:id/suggestions`: lists `items`, and answers a POST with `answer` (undated by default). */
function serve(answer?: { status: number; body: unknown }): unknown[] {
  const posts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        posts.push(body);
        const sent = CreateSuggestionBodySchema.parse(body);
        return answer === undefined
          ? json({
              ...declined,
              ...sent,
              when: null,
              minutes: 60,
              state: 'suggested',
              reason: null,
              decidedAt: null,
            })
          : json(answer.body, answer.status);
      }
      if (url.startsWith(`/v1/creators/${CREATOR}/suggestions?week=`)) return json({ items: [declined] });
      return json({}, 404);
    }),
  );
  return posts;
}

function renderSection(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgendaSection creatorId={CREATOR} creatorName="Anna" timezone="Europe/Paris" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T17:30:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Créatrices › Agenda (CR-05 lot c)', () => {
  it('lists her week with what she did of each, her reason included', async () => {
    serve();
    renderSection();
    const group = await screen.findByRole('region', { name: /Refusées/u });
    expect(within(group).getByText('Séance photo')).toBeDefined();
    expect(within(group).getByText('« Pas ce samedi »')).toBeDefined();
    expect(screen.getByText('1 proposée · 1 refusée')).toBeDefined();
  });

  it('proposes a task once, and says when it found no room in her dispos', async () => {
    const posts = serve();
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Proposer une tâche' }));
    const dialog = await screen.findByRole('dialog', { name: 'Proposer à Anna' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proposer' }));
    // No title: nothing is sent.
    expect(within(dialog).getByText('Donne-lui un titre.')).toBeDefined();
    expect(posts).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText('Quoi'), { target: { value: 'Live du jeudi' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proposer' }));
    expect(await screen.findByText(/^Proposée sans heure/u)).toBeDefined();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: 'Live du jeudi',
      category: 'shoot',
      when: { kind: 'timed', startsAt: '2026-11-03T17:00:00.000Z', endsAt: '2026-11-03T18:00:00.000Z' },
      purpose: null,
    });
  });

  it('says why the server refused it, and keeps what was typed', async () => {
    serve({
      status: 409,
      body: {
        error: {
          code: 'creator_suggestion_declined_recently_conflict',
          message: 'x',
          details: {},
          requestId: 'r1',
        },
      },
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Proposer une tâche' }));
    const dialog = await screen.findByRole('dialog', { name: 'Proposer à Anna' });
    fireEvent.change(within(dialog).getByLabelText('Quoi'), { target: { value: 'Séance photo' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proposer' }));
    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/^Elle a refusé cette tâche/u);
    expect(within(dialog).getByLabelText('Quoi')).toHaveProperty('value', 'Séance photo');
  });
});
