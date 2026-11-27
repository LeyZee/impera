import { describe, expect, it } from 'vitest';

import { registerOf } from '../register';

const AT = new Date('2026-10-17T21:00:00Z');
const step = (kind: 'free' | 'paid', outcome: 'sent' | 'opened' | 'bought' | 'refused') => ({
  stepIndex: 0,
  kind,
  outcome,
  priceMinor: null,
  sentAt: AT,
  at: AT,
});

describe('how frank her words may be (Charles 21/11)', () => {
  it('stays suggestive with no run, a run not engaged, or a run over', () => {
    expect(registerOf(null)).toBe('suggestive');
    expect(registerOf({ status: 'open', steps: [step('free', 'sent'), step('paid', 'sent')] })).toBe(
      'suggestive',
    );
    expect(registerOf({ status: 'bought_out', steps: [step('paid', 'bought')] })).toBe('suggestive');
  });

  it('may be crude once a paid step of the open run is bought', () => {
    expect(registerOf({ status: 'open', steps: [step('free', 'opened'), step('paid', 'bought')] })).toBe(
      'crude',
    );
  });
});
