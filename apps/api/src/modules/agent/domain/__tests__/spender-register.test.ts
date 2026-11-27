import { describe, expect, it } from 'vitest';

import { spenderRegisterOf } from '../spender-register';

const free = { fragile: false, care: false, moneyTrouble: false };

describe('spenderRegisterOf (ADR 0132 § 7, Charles 26/11)', () => {
  it('is girlfriend with a whale, close with a very good payer, warm below', () => {
    expect(spenderRegisterOf('whale', free)).toBe('girlfriend');
    expect(spenderRegisterOf('very_good', free)).toBe('close');
    expect(spenderRegisterOf('good', free)).toBe('warm');
    expect(spenderRegisterOf('payer', free)).toBe('warm');
    expect(spenderRegisterOf('new', free)).toBe('warm');
  });

  it('stays warm when his tier is unknown', () => {
    expect(spenderRegisterOf(null, free)).toBe('warm');
    expect(spenderRegisterOf(undefined, free)).toBe('warm');
  });

  it('bounds a fragile or broke whale to close, and keeps care plain (ADR 0132 § 13)', () => {
    expect(spenderRegisterOf('whale', { ...free, fragile: true })).toBe('close');
    expect(spenderRegisterOf('whale', { ...free, moneyTrouble: true })).toBe('close');
    expect(spenderRegisterOf('very_good', { ...free, fragile: true })).toBe('close');
    expect(spenderRegisterOf('whale', { ...free, care: true })).toBe('warm');
  });
});
