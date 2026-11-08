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
              // Sent, never read back: what a shoot is for leaves its trace in « À quoi ça sert ».
              dropCategory: undefined,
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
      // It is 18 h 30 in Paris: the form opens on the next half hour, never on an hour already begun.
      when: { kind: 'timed', startsAt: '2026-11-03T18:00:00.000Z', endsAt: '2026-11-03T19:00:00.000Z' },
      purpose: null,
    });
  });

  it('writes a reel sheet for a shoot of a Reel Insta, previewed as she will see it (VEI-08)', async () => {
    const posts = serve();
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Proposer une tâche' }));
    const dialog = await screen.findByRole('dialog', { name: 'Proposer à Anna' });
    fireEvent.change(within(dialog).getByLabelText('Quoi'), { target: { value: 'Reel café du matin' } });
    expect(within(dialog).queryByRole('heading', { name: 'Fiche reel' })).toBeNull();
    fireEvent.click(within(dialog).getByLabelText(/^Pour/u));
    fireEvent.click(await screen.findByRole('option', { name: /Reel Insta/u }));
    expect(within(dialog).getByRole('heading', { name: 'Fiche reel' })).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText(/Première phrase/u), {
      target: { value: 'Trois secondes pour te convaincre' },
    });
    fireEvent.change(within(dialog).getByLabelText('Plan 1'), {
      target: { value: 'Gros plan sur la tasse' },
    });
    // One shot only: what is missing is said, nothing is sent.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proposer' }));
    expect(within(dialog).getByText('Deux plans au moins.')).toBeDefined();
    expect(posts).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText('Plan 2'), { target: { value: 'Elle sourit' } });
    const preview = within(within(dialog).getByRole('group', { name: 'Ce qu’elle verra' }));
    expect(preview.getByText('Trois secondes pour te convaincre')).toBeDefined();
    const filmed = within(preview.getByRole('region', { name: 'Puis filme, dans l’ordre' }));
    expect(filmed.getAllByRole('listitem').map((shot) => shot.textContent)).toEqual([
      'Gros plan sur la tasse',
      'Elle sourit',
    ]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Proposer' }));
    expect(await screen.findByText(/^Proposée sans heure/u)).toBeDefined();
    expect(posts[0]).toMatchObject({
      dropCategory: 'instagram_reel',
      reelBrief: {
        hook: 'Trois secondes pour te convaincre',
        onScreen: null,
        shots: ['Gros plan sur la tasse', 'Elle sourit'],
        ending: null,
        seconds: 20,
      },
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
