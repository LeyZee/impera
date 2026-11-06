// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FromReader } from './protocol';
import { AMBER_AFTER_MS, WatchReader } from './runtime';

/* A made-up post page (ADR 0010): the reader's whole life on it, with the browser's observers stubbed. */

const CODE = 'Cx0abc12DEf';
const POST = `
<main><article>
  <a href="/atelier.lune/"><span>atelier.lune</span></a>
  <section><a href="/p/${CODE}/liked_by/"><span>842 mentions J’aime</span></a></section>
  <h1 dir="auto">Un foulard noué en trois gestes #foulard</h1>
</article></main>`;

type Seen = Pick<IntersectionObserverEntry, 'target' | 'intersectionRatio'>;

/** Stands for the browser's IntersectionObserver; the reader reads only `target` and `intersectionRatio`. */
class StubIntersectionObserver {
  static last: StubIntersectionObserver | null = null;
  readonly targets: Element[] = [];
  constructor(private readonly callback: (entries: readonly Seen[]) => void) {
    StubIntersectionObserver.last = this;
  }
  observe(target: Element): void {
    this.targets.push(target);
  }
  disconnect(): void {
    this.targets.length = 0;
  }
  show(target: Element, ratio: number): void {
    this.callback([{ target, intersectionRatio: ratio }]);
  }
}

function setup(
  path: string,
  body: string,
): { reader: WatchReader; sent: FromReader[]; location: { pathname: string } } {
  document.body.innerHTML = body;
  const sent: FromReader[] = [];
  const location = { pathname: path };
  const reader = new WatchReader({ document, location, send: (message) => sent.push(message) });
  return { reader, sent, location };
}

const seenPosts = (sent: readonly FromReader[]): unknown[] =>
  sent.flatMap((message) => (message.type === 'watch/seen' ? message.posts : []));

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-06T14:00:00Z') });
  vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WatchReader', () => {
  it('reads nothing and sends nothing before « Veille » starts', () => {
    const { reader, sent } = setup(`/p/${CODE}/`, POST);
    reader.flush();
    expect(reader.onScreen()).toBeNull();
    expect(sent).toEqual([]);
  });

  it('reads the post on screen and sends it with its time on screen', () => {
    const { reader, sent } = setup(`/p/${CODE}/`, POST);
    reader.start();
    vi.advanceTimersByTime(5_000);
    expect(seenPosts(sent)).toEqual([
      expect.objectContaining({
        code: CODE,
        account: 'atelier.lune',
        metrics: { views: null, likes: 842, comments: null },
        hashtags: ['foulard'],
        dwellMs: 5_000,
      }),
    ]);
    expect(reader.onScreen()?.post.code).toBe(CODE);
    reader.stop();
  });

  it('never reads the home feed nor messages', () => {
    for (const path of ['/', '/direct/inbox/']) {
      const { reader, sent } = setup(path, POST);
      reader.start();
      vi.advanceTimersByTime(10_000);
      reader.stop();
      expect(seenPosts(sent)).toEqual([]);
    }
  });

  it('follows the address: a post left stops counting its time', () => {
    const { reader, sent, location } = setup(`/p/${CODE}/`, POST);
    reader.start();
    vi.advanceTimersByTime(3_000);
    location.pathname = '/';
    vi.advanceTimersByTime(7_000);
    // Its time stopped when the address changed (read every half second), and was sent once.
    expect(seenPosts(sent).at(-1)).toEqual(expect.objectContaining({ code: CODE, dwellMs: 3_500 }));
    sent.length = 0;
    vi.advanceTimersByTime(10_000);
    reader.flush();
    expect(seenPosts(sent)).toEqual([]);
    reader.stop();
  });

  it('turns amber when a post shows and nothing of it can be read, and back when it can', () => {
    const { reader, sent } = setup(`/p/${CODE}/`, `<main><article><img alt=""></article></main>`);
    reader.start();
    vi.advanceTimersByTime(AMBER_AFTER_MS + 5_000);
    expect(sent).toContainEqual({ type: 'watch/health', amber: true });
    document.body.innerHTML = POST;
    vi.advanceTimersByTime(5_000);
    expect(sent.filter((message) => message.type === 'watch/health').at(-1)).toEqual({
      type: 'watch/health',
      amber: false,
    });
    reader.stop();
  });

  it('counts a grid tile only while most of it shows', () => {
    const grid = `<main><a href="/atelier.lune/reel/${CODE}/"><span><svg aria-label="Vues"></svg></span><span>3 k</span></a></main>`;
    const { reader, sent } = setup('/atelier.lune/reels/', grid);
    reader.start();
    const tile = document.querySelector('a');
    if (tile === null || StubIntersectionObserver.last === null) throw new Error('setup');
    StubIntersectionObserver.last.show(tile, 0.9);
    vi.advanceTimersByTime(2_000);
    StubIntersectionObserver.last.show(tile, 0.1);
    vi.advanceTimersByTime(3_000);
    expect(seenPosts(sent).at(-1)).toEqual(
      expect.objectContaining({
        code: CODE,
        metrics: { views: 3_000, likes: null, comments: null },
        dwellMs: 2_000,
      }),
    );
    reader.stop();
  });
});
