import {
  CreatorIdSchema,
  InstagramPostCodeSchema,
  TrendReadingsBatchSchema,
  WatchSessionIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { SeenPost } from './protocol';
import {
  addSeen,
  begin,
  EMPTY_STATE,
  end,
  expired,
  mark,
  parseState,
  prune,
  putBack,
  takeBatches,
  watchOf,
  WATCH_DURATION_MS,
} from './state';

const SESSION = WatchSessionIdSchema.parse('5b0a3c52-6d0e-4a59-9f1e-2a7c1d0b8e11');
const CREATOR = CreatorIdSchema.parse('0d4c7f5e-3b1a-4c8e-9a2d-6e5f4b3a2c10');
const NOW = new Date('2026-11-06T14:00:00Z');
const TAB = 41;

function seen(code: string, overrides: Partial<SeenPost> = {}): SeenPost {
  return {
    code: InstagramPostCodeSchema.parse(code),
    path: 'reel',
    account: 'atelier.lune',
    metrics: { views: null, likes: 120, comments: null },
    caption: null,
    hashtags: [],
    sound: null,
    soundId: null,
    dwellMs: 2_000,
    seenAt: NOW.toISOString(),
    ...overrides,
  };
}

const watching = begin(EMPTY_STATE, TAB, SESSION, NOW);

describe('a watch', () => {
  it('runs 45 minutes, then is due to stop', () => {
    expect(watchOf(watching, TAB)?.endsAt).toBe(new Date(NOW.getTime() + WATCH_DURATION_MS).toISOString());
    expect(expired(watching, new Date(NOW.getTime() + WATCH_DURATION_MS - 1))).toEqual([]);
    expect(expired(watching, new Date(NOW.getTime() + WATCH_DURATION_MS))).toEqual([TAB]);
  });

  it('counts each post once, whatever the times it is seen again', () => {
    let state = addSeen(watching, TAB, [seen('Cx0abc12DEf'), seen('Dy9zyx98WVu')]);
    state = addSeen(state, TAB, [seen('Cx0abc12DEf', { dwellMs: 9_000 })]);
    expect(watchOf(state, TAB)?.posts).toBe(2);
    expect(state.pending[SESSION]?.['Cx0abc12DEf']?.dwellMs).toBe(9_000);
  });

  it('ignores a tab that does not watch', () => {
    expect(addSeen(EMPTY_STATE, TAB, [seen('Cx0abc12DEf')])).toBe(EMPTY_STATE);
  });

  it('still takes the reader’s last posts for a minute after it ended', () => {
    const ended = end(watching, TAB, NOW);
    expect(watchOf(ended, TAB)).toBeNull();
    const late = addSeen(ended, TAB, [seen('Cx0abc12DEf')]);
    expect(Object.keys(late.pending[SESSION] ?? {})).toEqual(['Cx0abc12DEf']);
    const later = prune(late, new Date(NOW.getTime() + 61_000));
    expect(addSeen(later, TAB, [seen('Dy9zyx98WVu')]).pending[SESSION]?.['Dy9zyx98WVu']).toBeUndefined();
  });
});

describe('marking', () => {
  it('marks a post, and a later reading of it keeps the mark', () => {
    let state = mark(watching, TAB, seen('Cx0abc12DEf'), CREATOR);
    state = addSeen(state, TAB, [seen('Cx0abc12DEf', { dwellMs: 5_000 })]);
    expect(state.pending[SESSION]?.['Cx0abc12DEf']?.markedFor).toBe(CREATOR);
    expect(watchOf(state, TAB)?.marked).toBe(1);
    expect(state.lastCreatorId).toBe(CREATOR);
    expect(watchOf(mark(state, TAB, seen('Cx0abc12DEf'), CREATOR), TAB)?.marked).toBe(1);
  });
});

describe('sending', () => {
  it('makes batches the API takes, fifty posts at most', () => {
    const posts = Array.from({ length: 120 }, (_, index) => seen(`Code${String(index).padStart(4, '0')}x`));
    const { batches, rest } = takeBatches(addSeen(watching, TAB, posts));
    expect(batches.map((batch) => batch.readings.length)).toEqual([50, 50, 20]);
    for (const batch of batches) expect(TrendReadingsBatchSchema.safeParse(batch).success).toBe(true);
    expect(rest.pending).toEqual({});
  });

  it('puts back what was not sent, a newer reading winning', () => {
    const { batches, rest } = takeBatches(addSeen(watching, TAB, [seen('Cx0abc12DEf')]));
    const newer = addSeen(rest, TAB, [seen('Cx0abc12DEf', { dwellMs: 7_000 })]);
    expect(putBack(newer, batches).pending[SESSION]?.['Cx0abc12DEf']?.dwellMs).toBe(7_000);
    expect(putBack(rest, batches).pending[SESSION]?.['Cx0abc12DEf']?.dwellMs).toBe(2_000);
  });
});

describe('parseState', () => {
  it('starts empty from nothing or from a state it cannot read', () => {
    expect(parseState(undefined)).toEqual(EMPTY_STATE);
    expect(parseState({ watches: 'x' })).toEqual(EMPTY_STATE);
    expect(parseState(watching)).toEqual(watching);
  });
});
