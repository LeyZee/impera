import { describe, expect, it } from 'vitest';

import { PayPeriodSchema } from './pay-periods';
import {
  AccountPayRulesSchema,
  CreateAccountPayRulesBodySchema,
  PAY_RULES_ERROR_CODES,
  payRulesFor,
} from './pay-rules';

const ACCOUNT = '0199f2a0-0000-7000-8000-0000000000a1';

const body = {
  id: '0199f2a0-0000-7000-8000-0000000000a9',
  platformAccountId: ACCOUNT,
  fromPeriod: '2026-11-01',
  currency: 'EUR',
  vatBps: 2000,
  platformFeeBps: 2000,
  earningsSource: 'declared',
};

const rules = (fromPeriod: string, currency: 'EUR' | 'USD') =>
  AccountPayRulesSchema.parse({
    ...body,
    fromPeriod,
    currency,
    creatorId: '0199f2a0-0000-7000-8000-0000000000c1',
    createdAt: '2026-10-27T10:00:00Z',
  });

describe('an account’s pay rules', () => {
  it('takes whole basis points only: no float in pay (ADR 0011)', () => {
    expect(CreateAccountPayRulesBodySchema.safeParse(body).success).toBe(true);
    expect(CreateAccountPayRulesBodySchema.safeParse({ ...body, vatBps: 2000.5 }).success).toBe(false);
    expect(CreateAccountPayRulesBodySchema.safeParse({ ...body, platformFeeBps: 10_001 }).success).toBe(
      false,
    );
    expect(CreateAccountPayRulesBodySchema.safeParse({ ...body, vatBps: -1 }).success).toBe(false);
  });

  it('starts with a pay period, never in the middle of one', () => {
    expect(CreateAccountPayRulesBodySchema.safeParse({ ...body, fromPeriod: '2026-11-05' }).success).toBe(
      false,
    );
    expect(CreateAccountPayRulesBodySchema.safeParse({ ...body, earningsSource: 'both' }).success).toBe(
      false,
    );
  });

  it('applies the rules with the latest start at or before the period, whatever their order', () => {
    const first = rules('2026-10-01', 'EUR');
    const second = rules('2026-11-16', 'USD');
    const at = (day: string) => payRulesFor([second, first], PayPeriodSchema.parse(day))?.currency ?? null;
    expect(at('2026-09-16')).toBeNull();
    expect(at('2026-10-01')).toBe('EUR');
    expect(at('2026-11-01')).toBe('EUR');
    expect(at('2026-11-16')).toBe('USD');
    expect(at('2027-03-01')).toBe('USD');
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of PAY_RULES_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|forbidden)$/u);
    }
  });
});
