import type { CommentRatingVerdict } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  autonomyReadiness,
  boundedThresholds,
  DEFAULT_AUTONOMY_THRESHOLDS,
  refusalsSwitchAutonomyOff,
} from '../autonomy';

const many = (verdict: CommentRatingVerdict, count: number): CommentRatingVerdict[] =>
  Array.from({ length: count }, () => verdict);
// Fictitious thresholds: the real ones are the owner's setting.
const asked = { ratings: 12, validatedStreak: 6 };

describe('the readiness for autonomy (ADR 0122 § 5)', () => {
  it('is reached with enough ratings and the last ones validated', () => {
    expect(autonomyReadiness([...many('corrected', 6), ...many('validated', 6)], asked).ready).toBe(true);
  });

  it('is not reached with too few ratings', () => {
    expect(autonomyReadiness(many('validated', 11), asked).ready).toBe(false);
  });

  it('counts a corrected reply as a miss: it breaks the streak like a refusal', () => {
    const verdicts = [...many('validated', 10), 'corrected' as const, ...many('validated', 5)];
    const readiness = autonomyReadiness(verdicts, asked);
    expect(readiness.validatedStreak).toBe(5);
    expect(readiness.ready).toBe(false);
  });

  it('starts from nothing on a new persona version', () => {
    expect(autonomyReadiness([], asked)).toMatchObject({ ready: false, ratings: 0, validatedStreak: 0 });
  });

  it('keeps the owner’s setting inside the code’s floor and ceiling', () => {
    expect(boundedThresholds({ ratings: 0, validatedStreak: 0 })).toEqual({
      ratings: 10,
      validatedStreak: 5,
    });
    expect(boundedThresholds({ ratings: 9999, validatedStreak: 9999 })).toEqual({
      ratings: 500,
      validatedStreak: 100,
    });
    expect(boundedThresholds({ ratings: 10, validatedStreak: 50 })).toEqual({
      ratings: 10,
      validatedStreak: 10,
    });
  });

  it('uses the defaults when the owner set nothing, themselves inside the bounds', () => {
    expect(boundedThresholds(DEFAULT_AUTONOMY_THRESHOLDS)).toEqual(DEFAULT_AUTONOMY_THRESHOLDS);
    expect(autonomyReadiness(many('validated', DEFAULT_AUTONOMY_THRESHOLDS.ratings)).ready).toBe(true);
    expect(autonomyReadiness(many('validated', DEFAULT_AUTONOMY_THRESHOLDS.ratings - 1)).ready).toBe(false);
  });

  it('is switched off by two refusals of Meta in a row', () => {
    expect(refusalsSwitchAutonomyOff(1)).toBe(false);
    expect(refusalsSwitchAutonomyOff(2)).toBe(true);
  });
});
