import { DomainError, PayPeriodSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertRulesStart,
  assertSourceSwitchable,
  checkedPeriodOf,
  switchablePeriodOf,
  type RulesStart,
  type SwitchFacts,
} from '../pay-rules';

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
  const at = (patch: Partial<RulesStart> = {}): RulesStart => ({
    currentPeriod: current,
    first: false,
    checkedPeriod: null,
    closedFrom: false,
    ...patch,
  });
  const declared = (fromPeriod: string) => ({
    fromPeriod: period(fromPeriod),
    earningsSource: 'declared' as const,
  });
  const detected = (fromPeriod: string) => ({
    fromPeriod: period(fromPeriod),
    earningsSource: 'detected' as const,
  });

  it('takes a period that has not begun', () => {
    expect(codeOf(assertRulesStart, declared('2026-11-01'), at())).toBeNull();
    expect(codeOf(assertRulesStart, declared('2027-01-16'), at())).toBeNull();
    expect(codeOf(assertRulesStart, detected('2026-11-01'), at())).toBeNull();
  });

  it('takes the current period for the account’s first rules only', () => {
    expect(codeOf(assertRulesStart, declared(current), at({ first: true }))).toBeNull();
    expect(codeOf(assertRulesStart, declared(current), at())).toBe('pay_rules_period_invalid');
  });

  it('never takes a period already over, even for the first rules', () => {
    expect(codeOf(assertRulesStart, declared('2026-10-01'), at({ first: true }))).toBe(
      'pay_rules_period_invalid',
    );
    expect(codeOf(assertRulesStart, declared('2026-10-01'), at())).toBe('pay_rules_period_invalid');
  });

  it('lets the platform’s net start with the checked fortnight, over or under way, while nothing is closed from it (ADR 0084)', () => {
    const checkedPeriod = period('2026-10-01');
    expect(codeOf(assertRulesStart, detected('2026-10-01'), at({ checkedPeriod }))).toBeNull();
    expect(codeOf(assertRulesStart, detected('2026-10-01'), at({ checkedPeriod, first: true }))).toBeNull();
    // A closing at or after it: pay counted it, its base never changes.
    const closed = (): void => {
      assertRulesStart(detected('2026-10-01'), at({ checkedPeriod, closedFrom: true }));
    };
    expect(closed).toThrow(
      expect.objectContaining({ code: 'pay_rules_source_conflict', details: { reason: 'period_closed' } }),
    );
  });

  it('keeps every other begun period closed: the reports, or a fortnight that is not the checked one', () => {
    const checkedPeriod = period('2026-10-01');
    expect(codeOf(assertRulesStart, declared('2026-10-01'), at({ checkedPeriod }))).toBe(
      'pay_rules_period_invalid',
    );
    expect(codeOf(assertRulesStart, detected('2026-09-16'), at({ checkedPeriod }))).toBe(
      'pay_rules_period_invalid',
    );
    expect(codeOf(assertRulesStart, detected(current), at({ checkedPeriod }))).toBe(
      'pay_rules_period_invalid',
    );
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

  it('takes the fortnight checked itself, and refuses rules that start before it (ADR 0084)', () => {
    expect(refusal(ready, period('2026-11-01'))).toBeNull();
    expect(refusal(ready, period('2026-10-16'))).toBe('check_not_before');
    expect(refusal(ready, period('2026-10-01'))).toBe('check_not_before');
  });
});

describe('the fortnight a clean check lets the platform’s net start with (ADR 0084)', () => {
  const ready: SwitchFacts = {
    platform: 'reveal',
    modelLinked: true,
    lastCheck: { clean: true, fromDay: '2026-11-01', toDay: '2026-11-15' },
  };

  it('is the fortnight of a clean check on an account pay can read on its platform’s net', () => {
    expect(checkedPeriodOf(ready)).toBe('2026-11-01');
    expect(switchablePeriodOf(ready)).toBe('2026-11-01');
  });

  it('is none without a clean check over a whole fortnight', () => {
    expect(checkedPeriodOf({ ...ready, lastCheck: null })).toBeNull();
    expect(
      checkedPeriodOf({ ...ready, lastCheck: { clean: false, fromDay: '2026-11-01', toDay: '2026-11-15' } }),
    ).toBeNull();
    // A clean check always starts a period; a day inside one is never taken for it.
    expect(
      checkedPeriodOf({ ...ready, lastCheck: { clean: true, fromDay: '2026-11-03', toDay: '2026-11-15' } }),
    ).toBeNull();
  });

  it('is none for a platform without a net, or an account no model of it is linked to', () => {
    expect(switchablePeriodOf({ ...ready, platform: 'onlyfans' })).toBeNull();
    expect(switchablePeriodOf({ ...ready, modelLinked: false })).toBeNull();
  });
});
