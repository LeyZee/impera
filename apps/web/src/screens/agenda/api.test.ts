// @vitest-environment jsdom
import type { CreatorTask } from '@impera/contracts';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { archiveTask, flushGestures, NOT_SENT, tickTask } from './api';
import { live, post, WEDNESDAY } from './fixtures';
import { keepGesture, pendingGestures } from './offline';

/* Her ticks sent back (ADR 0042 § 8), invented (ADR 0010): what the server refuses is all that is forgotten. */

const refusal = (status: number, code: string, taskIds?: readonly string[]): Response =>
  new Response(
    JSON.stringify({
      error: { code, message: 'x', details: taskIds === undefined ? {} : { taskIds }, requestId: 'r' },
    }),
    { status },
  );

const added = (): Response => new Response(JSON.stringify({ added: 1 }), { status: 200 });

const bodies: unknown[] = [];

function answer(...responses: (() => Response | Promise<Response>)[]): void {
  bodies.length = 0;
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      const next = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return Promise.resolve(next === undefined ? added() : next());
    }),
  );
}

const tickOf = (taskId: CreatorTask['id'], doneAt = '2026-11-04T09:00:00.000Z') => ({
  kind: 'tick' as const,
  tick: { taskId, day: WEDNESDAY, doneAt },
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('her ticks sent back', () => {
  it('forgets only the ticks a refusal names, and sends the others again', async () => {
    keepGesture(tickOf(post.id));
    keepGesture(tickOf(live.id));
    answer(() => refusal(422, 'creator_tick_late_unprocessable', [live.id]), added);
    const flushed = await flushGestures(new QueryClient());
    expect(flushed).toEqual({ refused: 1, expired: false });
    expect(bodies).toEqual([
      { ticks: [tickOf(post.id).tick, tickOf(live.id).tick] },
      { ticks: [tickOf(post.id).tick] },
    ]);
    expect(pendingGestures()).toEqual([]);
  });

  it('keeps her ticks when her session expired or the server is busy, and says which', async () => {
    keepGesture(tickOf(post.id));
    answer(() => refusal(401, 'unauthorized'));
    expect(await flushGestures(new QueryClient())).toEqual({ refused: 0, expired: true });
    answer(() => refusal(429, 'rate_limited'));
    expect(await flushGestures(new QueryClient())).toEqual({ refused: 0, expired: false });
    expect(pendingGestures()).toEqual([tickOf(post.id)]);
  });

  it('sends a tap made while a send was running, once that send is answered', async () => {
    let release: () => void = () => undefined;
    const first = new Promise<Response>((resolve) => {
      release = () => {
        resolve(added());
      };
    });
    answer(() => first, added);
    const client = new QueryClient();
    const sending = tickTask(client, post, WEDNESDAY, true);
    void tickTask(client, live, WEDNESDAY, true);
    release();
    await sending;
    expect(bodies).toHaveLength(2);
    expect(pendingGestures()).toEqual([]);
  });
});

describe('a change that did not go through (recette 05/11, CREA-06)', () => {
  it('tells a server error from no network, and promises no send for later', async () => {
    answer(() => refusal(500, 'internal_error'));
    expect(await archiveTask(live.id)).toEqual({ kind: 'failed' });
    answer(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    expect(await archiveTask(live.id)).toEqual({ kind: 'failed' });
    answer(() => refusal(404, 'creator_task_not_found'));
    expect(await archiveTask(live.id)).toEqual({ kind: 'refused', code: 'creator_task_not_found' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    expect(await archiveTask(live.id)).toEqual({ kind: 'offline' });

    expect(NOT_SENT.failed).not.toMatch(/réseau/u);
    expect(NOT_SENT.offline).toMatch(/rien n’est parti/u);
    for (const text of Object.values(NOT_SENT)) expect(text).not.toMatch(/part quand/u);
  });
});
