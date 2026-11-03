import { PayPeriodSchema, PlatformAccountIdSchema, newId } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { detectedForCheck, type DatedAccountRules } from '../sales-checks';

const PARIS = 'Europe/Paris';
const period = (day: string) => PayPeriodSchema.parse(day);
const A = newId(PlatformAccountIdSchema);
const B = newId(PlatformAccountIdSchema);
const C = newId(PlatformAccountIdSchema);

const rules = (
  overrides: Partial<DatedAccountRules> & Pick<DatedAccountRules, 'platformAccountId'>,
): DatedAccountRules => ({
  platform: 'reveal',
  currency: 'EUR',
  fromPeriod: period('2026-10-01'),
  earningsSource: 'detected',
  createdAt: new Date('2026-09-20T10:00:00Z'),
  ...overrides,
});

describe('detectedForCheck (CRM-04 b3)', () => {
  it('keeps the accounts paid on the net over the whole fortnight, written before it', () => {
    expect(
      detectedForCheck(
        [
          rules({ platformAccountId: A }),
          // Declared: pay does not read the platform's net for it.
          rules({ platformAccountId: B, earningsSource: 'declared' }),
          // Detected from a later fortnight only.
          rules({ platformAccountId: C, fromPeriod: period('2026-11-01') }),
        ],
        period('2026-10-16'),
        PARIS,
      ),
    ).toEqual([{ platform: 'reveal', platformAccountId: A, currency: 'EUR' }]);
  });

  it('reads the rules in force for the fortnight, not the newest ones', () => {
    const history = [
      rules({ platformAccountId: A, fromPeriod: period('2026-09-01'), earningsSource: 'declared' }),
      rules({
        platformAccountId: A,
        fromPeriod: period('2026-10-16'),
        createdAt: new Date('2026-10-02T10:00:00Z'),
      }),
      rules({ platformAccountId: A, fromPeriod: period('2026-11-16'), earningsSource: 'declared' }),
    ];
    expect(detectedForCheck(history, period('2026-10-01'), PARIS)).toEqual([]);
    expect(detectedForCheck(history, period('2026-10-16'), PARIS)).toHaveLength(1);
    expect(detectedForCheck(history, period('2026-11-16'), PARIS)).toEqual([]);
  });

  it('leaves out the fortnight a first rule was written in (« à cheval »), in the agency’s zone', () => {
    // 23:30 UTC on the 15th is the 16th in Paris: written during the fortnight it starts with.
    const astride = [
      rules({
        platformAccountId: A,
        fromPeriod: period('2026-10-16'),
        createdAt: new Date('2026-10-15T23:30:00Z'),
      }),
    ];
    expect(detectedForCheck(astride, period('2026-10-16'), PARIS)).toEqual([]);
    expect(detectedForCheck(astride, period('2026-11-01'), PARIS)).toHaveLength(1);
  });
});
