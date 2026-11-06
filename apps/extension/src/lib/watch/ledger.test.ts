import { InstagramPostCodeSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { SeenLedger } from './ledger';
import type { PostSnapshot } from './reader';

const CODE = InstagramPostCodeSchema.parse('Cx0abc12DEf');
const OTHER = InstagramPostCodeSchema.parse('Dy9zyx98WVu');

function snapshot(overrides: Partial<PostSnapshot> = {}): PostSnapshot {
  return {
    code: CODE,
    path: 'post',
    account: null,
    metrics: { views: null, likes: null, comments: null },
    caption: null,
    hashtags: [],
    sound: null,
    soundId: null,
    ...overrides,
  };
}

function clock(start = Date.parse('2026-11-06T14:00:00Z')): {
  now: () => number;
  advance: (ms: number) => void;
} {
  let at = start;
  return {
    now: () => at,
    advance: (ms) => {
      at += ms;
    },
  };
}

describe('SeenLedger', () => {
  it('keeps what each page showed: views from the grid, likes from the post', () => {
    const time = clock();
    const ledger = new SeenLedger(time.now);
    ledger.record(
      snapshot({
        path: 'reel',
        account: 'atelier.lune',
        metrics: { views: 48_500, likes: null, comments: null },
      }),
    );
    ledger.record(snapshot({ metrics: { views: null, likes: 1234, comments: 12 }, caption: 'Un foulard' }));
    expect(ledger.drain()).toEqual([
      expect.objectContaining({
        path: 'reel',
        account: 'atelier.lune',
        metrics: { views: 48_500, likes: 1234, comments: 12 },
        caption: 'Un foulard',
        seenAt: '2026-11-06T14:00:00.000Z',
      }),
    ]);
  });

  it('hands over only what changed since the last drain', () => {
    const ledger = new SeenLedger(clock().now);
    ledger.record(snapshot());
    expect(ledger.drain()).toHaveLength(1);
    ledger.record(snapshot());
    expect(ledger.drain()).toHaveLength(0);
    ledger.record(snapshot({ code: OTHER }));
    ledger.record(snapshot({ metrics: { views: null, likes: 3, comments: null } }));
    expect(ledger.drain().map((post) => post.code)).toEqual([CODE, OTHER]);
  });

  it('counts the time a post stays on screen, and only then', () => {
    const time = clock();
    const ledger = new SeenLedger(time.now);
    ledger.record(snapshot());
    ledger.record(snapshot({ code: OTHER }));
    ledger.drain();
    ledger.showing(new Set([CODE]));
    time.advance(4_000);
    ledger.showing(new Set([OTHER]));
    time.advance(1_500);
    const drained = ledger.drain();
    expect(drained.find((post) => post.code === CODE)?.dwellMs).toBe(4_000);
    expect(drained.find((post) => post.code === OTHER)?.dwellMs).toBe(1_500);
    time.advance(500);
    expect(ledger.drain().map((post) => [post.code, post.dwellMs])).toEqual([[OTHER, 2_000]]);
  });

  it('never counts past the 45 minutes of a watch', () => {
    const time = clock();
    const ledger = new SeenLedger(time.now);
    ledger.record(snapshot());
    ledger.showing(new Set([CODE]));
    time.advance(50 * 60_000);
    expect(ledger.drain()[0]?.dwellMs).toBe(45 * 60_000);
  });
});
