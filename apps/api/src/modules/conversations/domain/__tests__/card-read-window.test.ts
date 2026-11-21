import { describe, expect, it } from 'vitest';

import {
  cardReadBatches,
  cardReadWindow,
  cardRereadWindow,
  type CardReadRow,
  type CardReadWindow,
  type CardRereadWindow,
} from '../card-read-window';

const T0 = Date.parse('2026-11-21T10:00:00Z');
const LIMITS = { window: 10, context: 3 };

/** A conversation in the platform's order: `f` his, `c` hers; each came in `in` ms after T0 (its order by default). */
function conversation(spec: string, ingested?: readonly number[]): CardReadRow<string>[] {
  return Array.from({ length: spec.length }, (_, index) => spec.charAt(index)).map((kind, index) => ({
    id: `m${String(index)}`,
    fromFan: kind === 'f',
    ingestedAt: new Date(T0 + (ingested?.[index] ?? index)),
  }));
}

/** Every one of his messages is read once: the reads chained until none is left. */
function readAll(rows: readonly CardReadRow<string>[]): { batches: string[][]; read: string[] } {
  let through: Date | null = null;
  const batches: string[][] = [];
  const read: string[] = [];
  for (;;) {
    const window: CardReadWindow<string> | null = cardReadWindow(rows, through, LIMITS);
    if (window === null) break;
    expect(window.ids.length).toBeLessThanOrEqual(LIMITS.window);
    batches.push([...window.ids]);
    read.push(...window.ids.filter((id) => window.newIds.has(id)));
    through = window.through;
    if (window.left === 0) break;
  }
  return { batches, read };
}

describe('which messages one read of his card gets (ADR 0085 § 7, amendement du 21/11)', () => {
  it('reads his oldest unread first, with a few before, and says how many are left', () => {
    const rows = conversation('cfcfcfffffffffffffff');
    const first = cardReadWindow(rows, null, LIMITS);

    expect(first?.ids[0]).toBe('m0');
    expect(first?.newIds.has('m0')).toBe(false);
    expect(first?.ids).toHaveLength(10);
    expect(first?.newIds.has('m1')).toBe(true);
    expect(first?.through).toEqual(new Date(T0 + 9));
    expect(first?.left).toBe(17 - (first?.newIds.size ?? 0));
  });

  it('never skips one of his messages, however long the history, and reads each once', () => {
    const rows = conversation('cf'.repeat(15) + 'f'.repeat(25));
    const fans = rows.filter((row) => row.fromFan).map((row) => row.id);
    const { batches, read } = readAll(rows);

    expect(batches.length).toBeGreaterThan(1);
    expect(read).toEqual(fans);
  });

  it('gives the messages before his first unread one as context, never new', () => {
    const rows = conversation('cfcfcfcfff');
    const window = cardReadWindow(rows, new Date(T0 + 6), LIMITS);

    expect(window?.ids).toEqual(['m4', 'm5', 'm6', 'm7', 'm8', 'm9']);
    expect([...(window?.newIds ?? [])]).toEqual(['m7', 'm8', 'm9']);
    expect(window?.left).toBe(0);
  });

  it('reads history caught up after the live messages once, after them, without marking it read before', () => {
    // m0..m4 came in live (0..4) and were read through 4; the older history m5..m9 shows first on the platform but came
    // in later (10..14).
    const rows = conversation('fffffcfcff', [10, 11, 12, 13, 14, 0, 1, 2, 3, 4]).map((row, index) => ({
      ...row,
      fromFan: index < 5 ? true : row.fromFan,
    }));
    const window = cardReadWindow(rows, new Date(T0 + 4), LIMITS);

    expect([...(window?.newIds ?? [])]).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(window?.through).toEqual(new Date(T0 + 14));
  });

  it('stops before a millisecond it would cut in two, so nothing read is marked unread or the reverse', () => {
    const rows = conversation('ffffffffffff', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10]);
    const window = cardReadWindow(rows, null, LIMITS);

    expect(window?.newIds.size).toBe(9);
    expect(window?.through).toEqual(new Date(T0 + 8));
    expect(window?.left).toBe(3);
  });

  it('has nothing to read when every message of his is read', () => {
    expect(cardReadWindow(conversation('cfcf'), new Date(T0 + 3), LIMITS)).toBeNull();
    expect(cardReadWindow(conversation('ccc'), null, LIMITS)).toBeNull();
  });
});

describe('the weekly re-read of a conversation (amendement du 21/11)', () => {
  it('reads the whole conversation again from its start, every message of his new, a batch at a time', () => {
    const rows = conversation('cf'.repeat(12));
    const read: string[] = [];
    let after: { id: string } | null = null;
    let batches = 0;
    for (;;) {
      const window: CardRereadWindow<string> | null = cardRereadWindow(rows, after, LIMITS);
      if (window === null) break;
      batches += 1;
      expect(window.ids.length).toBeLessThanOrEqual(LIMITS.window);
      read.push(...window.ids.filter((id) => window.newIds.has(id)));
      if (window.next === null) break;
      after = window.next;
    }

    expect(batches).toBeGreaterThan(2);
    expect(read).toEqual(rows.filter((row) => row.fromFan).map((row) => row.id));
  });

  it('starts again from the start when its cursor is gone, and ends when nothing of his is left', () => {
    const rows = conversation('cfcfcc');
    expect(cardRereadWindow(rows, { id: 'gone' }, LIMITS)?.ids[0]).toBe('m0');
    expect(cardRereadWindow(rows, { id: 'm3' }, LIMITS)).toBeNull();
  });
});

describe('the first pass counted without a call', () => {
  it('counts the reads the chain makes, none when all is read', () => {
    const rows = conversation('cf'.repeat(15) + 'f'.repeat(25));
    expect(cardReadBatches(rows, null, LIMITS)).toBe(readAll(rows).batches.length);
    expect(cardReadBatches(rows, new Date(T0 + 1_000), LIMITS)).toBe(0);
  });
});
