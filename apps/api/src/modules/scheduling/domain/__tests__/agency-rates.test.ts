import { DomainError } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { assertRateStart } from '../agency-rates';

/** The code the rule throws on these arguments, or `null`. */
function codeOf(fromDay: string, today: string, first: boolean): string | null {
  try {
    assertRateStart(fromDay, today, first);
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
  return null;
}

describe('when the agency’s percentage of a creator starts (CR-04)', () => {
  const today = '2026-11-03';

  it('takes a day that has not begun', () => {
    expect(codeOf('2026-11-04', today, false)).toBeNull();
    expect(codeOf('2027-01-01', today, true)).toBeNull();
  });

  it('takes today for her first percentage only', () => {
    expect(codeOf(today, today, true)).toBeNull();
    expect(codeOf(today, today, false)).toBe('agency_rate_day_invalid');
  });

  it('never takes a day that has passed, even for the first', () => {
    expect(codeOf('2026-11-02', today, true)).toBe('agency_rate_day_invalid');
    expect(codeOf('2025-12-31', today, false)).toBe('agency_rate_day_invalid');
  });
});
