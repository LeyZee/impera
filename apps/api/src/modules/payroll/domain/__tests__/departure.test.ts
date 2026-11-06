import { PayPeriodSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { departurePeriodOf, finalFor } from '../departure';

const period = (value: string) => PayPeriodSchema.parse(value);

describe('the final statement of a member who left (EQ-14, ADR 0072)', () => {
  it('is the one of the period that holds the day he left', () => {
    expect(departurePeriodOf('2025-07-03')).toBe('2025-07-01');
    expect(departurePeriodOf('2025-07-15')).toBe('2025-07-01');
    expect(departurePeriodOf('2025-07-16')).toBe('2025-07-16');
    expect(departurePeriodOf('2025-07-31')).toBe('2025-07-16');
    expect(departurePeriodOf('2025-12-20')).toBe('2025-12-16');
  });

  it('does not exist while he has not left', () => {
    expect(departurePeriodOf(null)).toBeNull();
    expect(finalFor(null, period('2025-07-16'))).toBe(false);
  });

  it('makes each statement of his final from his departure fortnight on, never before', () => {
    expect(finalFor('2025-07-03', period('2025-06-16'))).toBe(false);
    expect(finalFor('2025-07-03', period('2025-07-01'))).toBe(true);
    expect(finalFor('2025-07-03', period('2025-07-16'))).toBe(true);
    expect(finalFor('2025-07-03', period('2025-09-01'))).toBe(true);
  });
});
