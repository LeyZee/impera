import { DomainError, PayPeriodSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { assertRulesStart, assertSourceSwitchable, type SwitchFacts } from '../pay-rules';

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

describe('where pay reads an account (the switch guard, ADR 0050 § 8)', () => {
  const from = period('2026-11-16');
  const ready: SwitchFacts = {
    platform: 'reveal',
    modelLinked: true,
    lastCheck: { clean: true, fromDay: '2026-11-01', toDay: '2026-11-15' },
  };

  /** The reason `detected` is refused with on `facts`, `null` when it is taken. */
  function refusal(facts: SwitchFacts, fromPeriod = from): unknown {
    try {
      assertSourceSwitchable('detected', fromPeriod, facts);
    } catch (error) {
      if (!(error instanceof DomainError)) return 'unexpected';
      expect(error.code).toBe('pay_rules_source_conflict');
      return error.details['reason'];
    }
    return null;
  }

  it('always reads the reports, whatever the sales feed knows', () => {
    expect(
      codeOf(assertSourceSwitchable, 'declared', from, { ...ready, modelLinked: false, lastCheck: null }),
    ).toBeNull();
    expect(codeOf(assertSourceSwitchable, 'declared', from, { ...ready, platform: 'onlyfans' })).toBeNull();
  });

  it('reads the platform’s net once a linked model’s platform agreed over a whole fortnight before the rules', () => {
    expect(refusal(ready)).toBeNull();
    expect(refusal(ready, period('2027-01-01'))).toBeNull();
  });

  it('refuses a platform that gives no net, before anything else', () => {
    expect(refusal({ ...ready, platform: 'onlyfans', modelLinked: false, lastCheck: null })).toBe(
      'platform_without_net',
    );
  });

  it('refuses an account whose sales are not recorded: no model linked to it', () => {
    expect(refusal({ ...ready, modelLinked: false })).toBe('model_unlinked');
  });

  it('refuses before any check, and on a latest check that is not a clean match', () => {
    expect(refusal({ ...ready, lastCheck: null })).toBe('check_missing');
    expect(
      refusal({ ...ready, lastCheck: { clean: false, fromDay: '2026-11-01', toDay: '2026-11-15' } }),
    ).toBe('check_not_clean');
  });

  it('refuses rules that start before the end of the fortnight checked', () => {
    expect(refusal(ready, period('2026-11-01'))).toBe('check_not_before');
    expect(refusal(ready, period('2026-10-16'))).toBe('check_not_before');
  });
});
