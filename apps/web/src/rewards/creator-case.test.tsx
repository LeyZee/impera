// @vitest-environment jsdom
import type { TrophyCaseItem } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorEntry } from './creator-case';

const item = (over: Partial<TrophyCaseItem>): TrophyCaseItem => ({
  kind: 'day_streak_14',
  family: 'medal',
  earnedAt: null,
  revealedAt: null,
  progress: null,
  ...over,
});

describe('creatorEntry', () => {
  it('names a streak medal and counts the days left', () => {
    const entry = creatorEntry(item({ progress: { current: 9, target: 14, unit: 'day' } }));
    expect(entry?.name).toBe('Série de 14 jours');
    expect(entry?.left).toBe('Encore 5 jours');
    expect(entry?.how).toBe('Réussis ta routine 14 jours de suite.');
    expect(entry?.reveal.tone).toBe('gold');
  });

  it('counts deliveries on time by the count alone, its name saying what it counts (CRE-14)', () => {
    const entry = creatorEntry(
      item({
        kind: 'delivery_streak_5',
        family: 'streak',
        progress: { current: 4, target: 5, unit: 'delivery' },
      }),
    );
    expect(entry?.left).toBe('Encore 1');
    expect(entry?.reveal.kicker).toBe('Série de livraisons');
  });

  it('writes nothing left for a trophy earned at once, and leaves out a kind it does not know', () => {
    expect(creatorEntry(item({ kind: 'first_drop', family: 'trophy' }))?.left).toBeUndefined();
    // Still ahead, 0 of 1: how to earn it says it, never « Encore 1 » (CRE-14).
    expect(
      creatorEntry(
        item({ kind: 'first_drop', family: 'trophy', progress: { current: 0, target: 1, unit: 'once' } }),
      )?.left,
    ).toBeUndefined();
    expect(creatorEntry(item({ kind: 'tier:500' }))).toBeNull();
  });
});
