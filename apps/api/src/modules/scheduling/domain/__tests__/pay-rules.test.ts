import { DomainError, PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { assertRulesStart, assertSourceRecorded } from '../pay-rules';

const period = (day: string) => PayPeriodSchema.parse(day);

/** The code a rule throws on these arguments, or `null`. */
function codeOf<Args extends unknown[]>(rule: (...args: Args) => unknown, ...args: Args): string | null {
  try {
    rule(...args);
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
  return null;
}

describe('when an account’s pay rules start', () => {
  const current = period('2026-10-16');

  it('takes a period that has not begun', () => {
    expect(codeOf(assertRulesStart, period('2026-11-01'), current, false)).toBeNull();
    expect(codeOf(assertRulesStart, period('2027-01-16'), current, false)).toBeNull();
  });

  it('takes the current period for the account’s first rules only', () => {
    expect(codeOf(assertRulesStart, current, current, true)).toBeNull();
    expect(codeOf(assertRulesStart, current, current, false)).toBe('pay_rules_period_invalid');
  });

  it('never takes a period already over, even for the first rules', () => {
    expect(codeOf(assertRulesStart, period('2026-10-01'), current, true)).toBe('pay_rules_period_invalid');
    expect(codeOf(assertRulesStart, period('2026-10-01'), current, false)).toBe('pay_rules_period_invalid');
  });
});

describe('where pay reads an account', () => {
  it('reads the reports, and the sales only once the connector records them (P6-01)', () => {
    expect(codeOf(assertSourceRecorded, 'declared')).toBeNull();
    expect(codeOf(assertSourceRecorded, 'detected')).toBe('pay_rules_source_conflict');
  });
});
