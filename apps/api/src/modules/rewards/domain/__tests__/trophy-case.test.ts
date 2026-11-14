import { owedReveals, TrophyCaseSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { TROPHY_KINDS } from '../trophies';
import { gainKeyOf, trophyCaseOf, type StoredGain } from '../trophy-case';

const gain = (kind: StoredGain['kind'], earned: string, scopeKey = '', revealed?: string): StoredGain => ({
  kind,
  scopeKey,
  earnedAt: new Date(earned),
  revealedAt: revealed === undefined ? null : new Date(revealed),
});

describe('trophyCaseOf (ADR 0104 § 13 and § 15)', () => {
  it('lists every trophy of the closed list, none earned, for a member with nothing', () => {
    const empty = trophyCaseOf([], { current: 0, best: 0 });
    expect(TrophyCaseSchema.safeParse(empty).success).toBe(true);
    expect(empty.items.map((item) => item.kind)).toEqual([...TROPHY_KINDS]);
    expect(empty.items.every((item) => item.earnedAt === null && item.revealedAt === null)).toBe(true);
    expect(empty.streaks).toEqual([{ kind: 'shift', current: 0, best: 0 }]);
    expect(empty.level).toBeNull();
  });

  it('shows how far the streak is from each streak trophy still ahead, and nothing on the others', () => {
    const { items } = trophyCaseOf([gain('streak_5', '2026-11-10T10:00:00Z')], { current: 7, best: 7 });
    const progress = (kind: string) => items.find((item) => item.kind === kind)?.progress;
    expect(progress('streak_5')).toBeNull();
    expect(progress('streak_10')).toEqual({ current: 7, target: 10, unit: 'shift' });
    expect(progress('streak_25')).toEqual({ current: 7, target: 25, unit: 'shift' });
    expect(progress('first_sale')).toBeNull();
    expect(items.find((item) => item.kind === 'streak_10')?.family).toBe('streak');
    expect(items.find((item) => item.kind === 'first_sale')?.family).toBe('trophy');
  });

  it('adds the tiers reached as medals, a fortnight and a threshold each, with no amount', () => {
    const trophyCase = trophyCaseOf(
      [
        gain('tier', '2026-11-12T10:00:00Z', '2026-11-01:200000'),
        gain('tier', '2026-11-08T10:00:00Z', '2026-11-01:100000', '2026-11-08T12:00:00Z'),
        gain('first_sale', '2026-11-02T10:00:00Z'),
      ],
      { current: 0, best: 0 },
    );
    const tiers = trophyCase.items.filter((item) => item.family === 'medal');
    expect(tiers.map((item) => item.kind)).toEqual(['tier:2026-11-01:100000', 'tier:2026-11-01:200000']);
    expect(tiers.every((item) => item.progress === null)).toBe(true);
    expect(owedReveals(trophyCase).map((item) => item.kind)).toEqual([
      'first_sale',
      'tier:2026-11-01:200000',
    ]);
  });

  it('reads back the stored key of an item', () => {
    expect(gainKeyOf('first_sale')).toEqual({ kind: 'first_sale', scopeKey: '' });
    expect(gainKeyOf('tier:2026-11-01:100000')).toEqual({ kind: 'tier', scopeKey: '2026-11-01:100000' });
  });
});
