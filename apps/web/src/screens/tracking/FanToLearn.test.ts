import { describe, expect, it } from 'vitest';

import { kycRefreshMs, retryKyc, toLearnLine } from './FanToLearn';
import { FanKycRefused } from './api';

describe('Suivi › À apprendre (P5-01)', () => {
  it('names the canvas lines word for word, in the order served', () => {
    expect(toLearnLine(['situation', 'first_name', 'hobbies'])).toBe('Situation, Prénom, Passions');
  });

  it('asks a silent server again, never one that refused', () => {
    const down = new Error('GET kyc: 500');
    expect([0, 1, 2, 3].map((failures) => retryKyc(failures, down))).toEqual([true, true, true, false]);
    expect(retryKyc(0, new FanKycRefused('GET kyc: 404'))).toBe(false);
    expect(kycRefreshMs(down)).toBe(30_000);
    expect(kycRefreshMs(null)).toBe(30_000);
    expect(kycRefreshMs(new FanKycRefused('GET kyc: 403'))).toBe(false);
  });
});
