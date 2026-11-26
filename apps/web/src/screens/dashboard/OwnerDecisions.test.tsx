// @vitest-environment jsdom
import { CreatorSummarySchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OwnerDecisions } from './OwnerDecisions';

/* Invented creators and questions (ADR 0010). */
const NORA = CreatorSummarySchema.parse({
  id: '0192f3a0-0000-7000-8000-0000000000c1',
  displayName: 'Nora',
  timezone: 'Europe/Paris',
});
const INES = CreatorSummarySchema.parse({
  id: '0192f3a0-0000-7000-8000-0000000000c2',
  displayName: 'Ines',
  timezone: 'Europe/Paris',
});
const question = (n: number, expiresAt: string) => ({
  id: `01936f00-0000-7000-8000-${String(n).padStart(12, '0')}`,
  kind: 'publish_time',
  category: 'post',
  question: `Je publie ton Reel ${String(n)} ?`,
  context: 'Un Reel inventé.',
  layout: 'buttons',
  answers: [
    { key: 'yes', label: 'Oui', text: null, noted: 'C’est noté.' },
    { key: 'change', label: 'Changer l’heure', text: null, noted: 'On change.' },
  ],
  otherIdeasLeft: 0,
  expiresAt,
});

function serve(lists: Record<string, unknown[]>): { method: string; path: string; body: unknown }[] {
  const posts: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname;
      if (init?.method === 'POST') {
        posts.push({
          method: 'POST',
          path,
          body: JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
        });
        return Promise.resolve(new Response(JSON.stringify({ noted: 'C’est noté.' })));
      }
      const creatorId = path.split('/')[3] ?? '';
      return Promise.resolve(new Response(JSON.stringify({ decisions: lists[creatorId] ?? [] })));
    }),
  );
  return posts;
}

function renderCard(showWho: boolean, creators = [NORA, INES]): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OwnerDecisions creators={creators} showWho={showWho} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Elle n’a pas encore répondu », the owner answering in her place (INS-05)', () => {
  it('says the number first, then her question that ends first, with her name, and answers on the owner’s route', async () => {
    const posts = serve({
      [NORA.id]: [question(1, '2099-01-02T10:00:00Z')],
      [INES.id]: [question(2, '2099-01-01T10:00:00Z')],
    });
    renderCard(true);
    expect(
      (await screen.findByRole('heading', { level: 2, name: '2 questions sans réponse' })).textContent,
    ).toBe('2 questions sans réponse');
    expect(screen.getByText('Je publie ton Reel 2 ?')).toBeTruthy();
    expect(screen.getByText('Tu réponds à la place de Ines.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plus tard' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Oui' }));
    await waitFor(() => {
      expect(posts).toEqual([
        {
          method: 'POST',
          path: `/v1/creators/${INES.id}/decisions/01936f00-0000-7000-8000-000000000002/answer`,
          body: { answer: 'yes' },
        },
      ]);
    });
  });

  it('shows nothing when nothing waits', async () => {
    serve({});
    renderCard(false, [NORA]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
