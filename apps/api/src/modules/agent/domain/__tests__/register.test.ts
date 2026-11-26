import { describe, expect, it } from 'vitest';

import { registerOf, type RegisterInput } from '../register';

const AT = new Date('2026-10-17T21:00:00Z');
const step = (kind: 'free' | 'paid', outcome: 'sent' | 'opened' | 'bought' | 'refused') => ({
  stepIndex: 0,
  kind,
  outcome,
  priceMinor: null,
  sentAt: AT,
  at: AT,
});

const BASE: RegisterInput = {
  run: null,
  hot: false,
  heIsCrude: false,
  ageConfirmed: true,
  noExplicit: false,
};
const teased = { status: 'open' as const, steps: [step('free', 'sent')] };

describe('how frank her words may be (Charles 21/11, 26/11 at 21:16)', () => {
  it('stays suggestive with no run, a run over, or a warm fan who saw no teaser', () => {
    expect(registerOf(BASE)).toBe('suggestive');
    expect(registerOf({ ...BASE, hot: true })).toBe('suggestive');
    expect(registerOf({ ...BASE, run: { status: 'bought_out', steps: [step('paid', 'bought')] } })).toBe(
      'suggestive',
    );
    expect(registerOf({ ...BASE, run: teased })).toBe('suggestive');
  });

  it('may be crude once he is hot and saw the free teaser, without a purchase', () => {
    expect(registerOf({ ...BASE, run: teased, hot: true })).toBe('crude');
  });

  it('may be crude as soon as he is crude first', () => {
    expect(registerOf({ ...BASE, heIsCrude: true })).toBe('crude');
  });

  it('may be crude once a paid step of the open run is bought', () => {
    expect(
      registerOf({
        ...BASE,
        run: { status: 'open', steps: [step('free', 'opened'), step('paid', 'bought')] },
      }),
    ).toBe('crude');
  });

  it('is never crude before his adult age is confirmed, nor when he asked for nothing explicit', () => {
    const hottest = { ...BASE, run: teased, hot: true, heIsCrude: true };
    expect(registerOf({ ...hottest, ageConfirmed: false })).toBe('suggestive');
    expect(registerOf({ ...hottest, noExplicit: true })).toBe('suggestive');
  });
});
