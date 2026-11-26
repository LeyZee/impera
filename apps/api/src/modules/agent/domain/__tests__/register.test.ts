import { describe, expect, it } from 'vitest';

import { REGISTER_LADDER, registerOf, type RegisterInput } from '../register';

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
  seenIntensities: [],
  hot: false,
  heIsCrude: false,
  afterFinale: false,
  ageConfirmed: true,
  noExplicit: false,
};
const teased = { status: 'open' as const, steps: [step('free', 'sent')] };

describe('how frank her words may be: a ladder (Charles 21/11, 26/11 at 21:16 and 22:47)', () => {
  it('keeps its rungs in order, with neutral names', () => {
    expect(REGISTER_LADDER).toEqual(['suggestive', 'sensual', 'explicit', 'very_explicit']);
  });

  it('before any script, follows his level, capped at explicit', () => {
    expect(registerOf(BASE)).toBe('suggestive');
    expect(registerOf({ ...BASE, hot: true })).toBe('sensual');
    expect(registerOf({ ...BASE, heIsCrude: true })).toBe('explicit');
    expect(registerOf({ ...BASE, heIsCrude: true, seenIntensities: ['hardcore'] })).toBe('explicit');
    expect(registerOf({ ...BASE, run: { status: 'bought_out', steps: [step('paid', 'bought')] } })).toBe(
      'suggestive',
    );
  });

  it('opens explicit once he is hot and saw the free teaser, without a purchase; not a warm fan', () => {
    expect(registerOf({ ...BASE, run: teased, hot: true })).toBe('explicit');
    expect(registerOf({ ...BASE, run: teased })).toBe('suggestive');
  });

  it('climbs with the intensity of each step he has seen, never prim on an explicit one', () => {
    const at = (seenIntensities: string[]) => registerOf({ ...BASE, run: teased, seenIntensities });
    expect(at(['soft'])).toBe('suggestive');
    expect(at(['soft', 'suggestive'])).toBe('sensual');
    expect(at(['soft', 'suggestive', 'explicit'])).toBe('explicit');
    expect(at(['soft', 'hardcore'])).toBe('very_explicit');
    expect(at(['not_visible'])).toBe('suggestive');
  });

  it('says nothing of a gesture not shown yet: only what he has seen counts, not a step still to come', () => {
    // The steps he has seen showed nothing explicit: his own heat cannot take her past explicit.
    expect(registerOf({ ...BASE, run: teased, hot: true, heIsCrude: true, seenIntensities: ['soft'] })).toBe(
      'explicit',
    );
    expect(registerOf({ ...BASE, run: teased, hot: true, seenIntensities: ['suggestive'] })).not.toBe(
      'very_explicit',
    );
  });

  it('turns tender after the last step and his orgasm', () => {
    expect(registerOf({ ...BASE, afterFinale: true, seenIntensities: ['hardcore'] })).toBe('tender');
  });

  it('is never past suggestive before his adult age is confirmed, nor when he asked for nothing explicit', () => {
    const hottest = { ...BASE, run: teased, hot: true, heIsCrude: true, seenIntensities: ['hardcore'] };
    expect(registerOf({ ...hottest, ageConfirmed: false })).toBe('suggestive');
    expect(registerOf({ ...hottest, noExplicit: true })).toBe('suggestive');
  });
});
