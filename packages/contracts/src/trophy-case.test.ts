import { describe, expect, it } from 'vitest';

import { owedReveals, TrophyCaseSchema } from './trophy-case';

const item = (kind: string, earnedAt: string | null, revealedAt: string | null = null) => ({
  kind,
  family: 'trophy' as const,
  earnedAt,
  progress: null,
  revealedAt,
});

describe('the trophy case (ADR 0104, 0107, 0108)', () => {
  it('takes earned and unearned objects, streaks and an optional level', () => {
    const parsed = TrophyCaseSchema.safeParse({
      items: [
        item('first_sale', '2026-11-02T10:00:00Z', '2026-11-02T18:00:00Z'),
        {
          kind: 'streak_5',
          family: 'streak',
          earnedAt: null,
          progress: { current: 3, target: 5, unit: 'shift' },
          revealedAt: null,
        },
      ],
      streaks: [{ kind: 'shift', current: 3, best: 4 }],
      level: null,
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a progress without a target, a family or a unit it does not know', () => {
    const base = { streaks: [], level: null };
    const progress = (value: object) =>
      TrophyCaseSchema.safeParse({ ...base, items: [{ ...item('streak_5', null), progress: value }] })
        .success;
    expect(progress({ current: 1, target: 0, unit: 'shift' })).toBe(false);
    expect(progress({ current: 1.5, target: 5, unit: 'shift' })).toBe(false);
    expect(progress({ current: 1, target: 5, unit: 'message' })).toBe(false);
    expect(
      TrophyCaseSchema.safeParse({ ...base, items: [{ ...item('x', null), family: 'rank' }] }).success,
    ).toBe(false);
  });

  it('owes a reveal for what is earned and not played yet, oldest first', () => {
    const trophyCase = TrophyCaseSchema.parse({
      items: [
        item('day_record', '2026-11-05T10:00:00Z'),
        item('first_sale', '2026-11-02T10:00:00Z'),
        item('fortnight_record', '2026-11-01T10:00:00Z', '2026-11-01T12:00:00Z'),
        item('streak_5', null),
      ],
      streaks: [],
      level: null,
    });
    expect(owedReveals(trophyCase).map((owed) => owed.kind)).toEqual(['first_sale', 'day_record']);
  });
});
