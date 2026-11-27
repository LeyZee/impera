// @vitest-environment jsdom
import { ChannelPlannedPostSchema, CreatorIdSchema, type ChannelPlannedPost } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChannelWeekSection } from './ChannelWeekSection';

/* An invented creator and invented posts: no real person, no real text. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const NOW = new Date('2026-11-30T08:00:00Z');

const post = (n: number, patch: Record<string, unknown> = {}): ChannelPlannedPost =>
  ChannelPlannedPostSchema.parse({
    id: `0192f3a0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`,
    creatorId: CREATOR,
    day: '2026-11-30',
    window: { from: 9 * 60, until: 11 * 60 },
    at: '2026-11-30T09:12:00Z',
    role: 'engagement',
    kind: 'text',
    theme: 'chat',
    draft: { kind: 'post', segments: [{ text: 'Un café inventé', style: 'plain' }], link: null, html: 'x' },
    mediaId: null,
    why: null,
    repost: false,
    state: 'planned',
    locked: false,
    review: null,
    replacesId: null,
    reason: null,
    sentAt: null,
    ...patch,
  });

const week = (posts: readonly ChannelPlannedPost[], reviewed = 0) => ({
  week: '2026-11-30',
  posts,
  reviewed,
  total: posts.filter((one) => one.state !== 'removed').length,
  thumbnails: {},
});

function serve(answers: Record<string, () => { status: number; body: unknown }>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      const key = Object.keys(answers).find((one) => {
        const [verb = '', fragment = ''] = one.split(' ');
        return verb === method && url.includes(fragment);
      });
      const answer =
        key === undefined ? { status: 404, body: null } : (answers[key]?.() ?? { status: 404, body: null });
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }),
  );
  return calls;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ChannelWeekSection creatorId={CREATOR} timeZone="Europe/Paris" now={() => NOW} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('La semaine du canal', () => {
  it('says first how many posts wait for a read, and validates them all in one gesture', async () => {
    let validated = false;
    const calls = serve({
      'GET /week': () => ({
        status: 200,
        body: validated
          ? week(
              [
                post(1, {
                  locked: true,
                  review: { action: 'validated', byName: 'Charles', at: NOW.toISOString() },
                }),
              ],
              1,
            )
          : week([post(1)]),
      }),
      'POST /week/validate': () => {
        validated = true;
        return { status: 200, body: { validated: 1 } };
      },
    });
    mount();
    expect(await screen.findByText('1 post à relire')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tout valider' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oui, valider les 1' }));
    expect(await screen.findByText('1 post validé.')).toBeTruthy();
    expect(await screen.findByText('Tout est relu')).toBeTruthy();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ week: '2026-11-30' });
  });

  it('opens a post in place and says a refusal in the server’s words', async () => {
    serve({
      'GET /week': () => ({ status: 200, body: week([post(1)]) }),
      'POST /posts/': () => ({
        status: 400,
        body: {
          error: {
            code: 'telegram_channel_gesture_invalid',
            message: 'Son heure est passée : il est parti ou il part.',
            details: { kind: 'too_late', message: 'Son heure est passée : il est parti ou il part.' },
            requestId: 'r',
          },
        },
      }),
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('button', { name: 'Valider' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Son heure est passée : il est parti ou il part.',
    );
  });

  it('says a week not planned yet, without a gesture', async () => {
    serve({ 'GET /week': () => ({ status: 200, body: week([]) }) });
    mount();
    expect(await screen.findByText('Pas encore planifiée')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tout valider' })).toBeNull();
  });

  it('moves to the next week', async () => {
    const calls = serve({ 'GET /week': () => ({ status: 200, body: week([]) }) });
    mount();
    await screen.findByText('Pas encore planifiée');
    fireEvent.click(screen.getByRole('button', { name: 'Semaine d’après' }));
    await waitFor(() => {
      expect(calls.some((call) => call.url.endsWith('week=2026-12-07'))).toBe(true);
    });
  });
});
