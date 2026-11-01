import { describe, expect, it } from 'vitest';

import {
  FanFlagsSchema,
  FanKycViewSchema,
  KYC_SLOT_LABELS,
  KycSlotSchema,
  SetFanFlagBodySchema,
  SPENDING_LIMIT_MAX_MINOR,
} from './fans';

describe('fans', () => {
  it('names each KYC slot as the notes canvas does', () => {
    expect(KycSlotSchema.options.map((slot) => KYC_SLOT_LABELS[slot])).toEqual([
      'Prénom',
      'Localisation',
      'Âge',
      'Métier',
      'Passions',
      'Envies',
      'Situation',
    ]);
  });

  it('reads the flags of a fan, none by default', () => {
    expect(FanFlagsSchema.parse({})).toEqual({});
    expect(
      FanFlagsSchema.parse({
        ageConfirmedAt: '2026-10-01T10:00:00Z',
        salesFrozen: { reason: 'money_trouble', since: '2026-10-02T10:00:00Z' },
        spendingLimitMinor: 5000,
        fragile: true,
      }),
    ).toMatchObject({ salesFrozen: { reason: 'money_trouble' }, spendingLimitMinor: 5000 });
  });

  it('refuses an unknown flag, a false flag and a reason that is not listed', () => {
    expect(FanFlagsSchema.safeParse({ vip: true }).success).toBe(false);
    expect(FanFlagsSchema.safeParse({ doNotContact: false }).success).toBe(false);
    expect(
      FanFlagsSchema.safeParse({ salesFrozen: { reason: 'bored', since: '2026-10-02T10:00:00Z' } }).success,
    ).toBe(false);
  });

  it('takes a ceiling above 0 € and up to 100 000 € only', () => {
    const ceiling = (limitMinor: number) =>
      SetFanFlagBodySchema.safeParse({ flag: 'spendingLimitMinor', set: true, limitMinor }).success;
    expect(ceiling(4_990)).toBe(true);
    expect(ceiling(SPENDING_LIMIT_MAX_MINOR)).toBe(true);
    expect(ceiling(0)).toBe(false);
    expect(ceiling(SPENDING_LIMIT_MAX_MINOR + 1)).toBe(false);
  });

  it('lifts any limit but a disputed age, which only a confirmation ends (SUIVI-04)', () => {
    const lift = (flag: string) => SetFanFlagBodySchema.safeParse({ flag, set: false, reason: 'x' }).success;
    expect(lift('ageConfirmedAt')).toBe(true);
    expect(lift('salesFrozen')).toBe(true);
    expect(lift('ageDisputed')).toBe(false);
  });

  it('says the lines left to learn of a fan as canvas slots only', () => {
    const fanId = '0192a0e4-7b1c-7cc0-8a4e-3f5d9b2c1a02';
    expect(FanKycViewSchema.safeParse({ fanId, toLearn: ['location', 'job'] }).success).toBe(true);
    expect(FanKycViewSchema.safeParse({ fanId, toLearn: [] }).success).toBe(true);
    expect(FanKycViewSchema.safeParse({ fanId, toLearn: ['city'] }).success).toBe(false);
  });
});
