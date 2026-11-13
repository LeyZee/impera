import { PayPeriodSchema, type BonusTier, type TrophyCase } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { chatterCase } from './chatter-case';

const NOV1 = PayPeriodSchema.parse('2026-11-01');
const TIERS: readonly BonusTier[] = [
  { label: 'Bronze', thresholdMinor: 50_000, bonusMinor: 1_000 },
  { label: 'Argent', thresholdMinor: 100_000, bonusMinor: 2_500 },
];
const gain = (kind: string, earnedAt: string, revealedAt: string | null) =>
  ({ kind, family: 'medal', earnedAt, progress: null, revealedAt }) as const;
const CASE: TrophyCase = {
  items: [
    gain('tier:2026-10-16:50000', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'),
    gain('tier:2026-11-01:50000', '2026-11-09T10:00:00.000Z', null),
    {
      kind: 'streak_5',
      family: 'streak',
      earnedAt: null,
      progress: { current: 3, target: 5, unit: 'shift' },
      revealedAt: null,
    },
  ],
  streaks: [{ kind: 'shift', current: 3, best: 3 }],
  level: null,
};

describe('chatterCase', () => {
  const shown = chatterCase(CASE, NOV1, 62_000, 'EUR', TIERS);

  it('shows one medal per threshold: earned with its count, ahead with what the statement says is left', () => {
    expect(shown.trophyCase.items.map((item) => item.kind)).toEqual([
      'tier:50000',
      'tier:100000',
      'streak_5',
    ]);
    const [bronze, argent, streak] = shown.trophyCase.items;
    expect(bronze).toMatchObject({ earnedAt: '2026-11-09T10:00:00.000Z', revealedAt: null, progress: null });
    expect(argent).toMatchObject({
      earnedAt: null,
      progress: { current: 62_000, target: 100_000, unit: 'cents' },
    });
    if (bronze === undefined || argent === undefined || streak === undefined) throw new Error('no item');
    expect(shown.entry(bronze)).toMatchObject({
      name: 'Palier Bronze',
      earnedNote: '2 fois · dernière le 9 nov.',
    });
    expect(shown.entry(argent)?.left).toMatch(/^Encore 380/u);
    expect(shown.entry(streak)).toMatchObject({ name: 'Série de 5', left: 'Encore 2' });
  });

  it('marks as seen the server’s own kinds, the unseen fortnights of a medal', () => {
    expect(shown.toStoredKinds(['tier:50000', 'streak_5'])).toEqual(['tier:2026-11-01:50000', 'streak_5']);
  });
});
