import { describe, expect, it } from 'vitest';

import { TRIAL_SCRIPTS, trialScript } from '../trial-scripts';

describe('trial scripts (ADR 0103 § 15-17)', () => {
  it('has one script for her day and one for her night, each with an offered step, a paid one and media', () => {
    expect(TRIAL_SCRIPTS.map((script) => script.moment)).toEqual(['day', 'night']);
    for (const script of TRIAL_SCRIPTS) {
      expect(script.steps[0]?.kind).toBe('free');
      expect(script.steps.some((step) => step.kind === 'paid')).toBe(true);
      expect(script.mediaValidated && script.descriptionValidated && !script.touchesLimits).toBe(true);
    }
  });

  it('prices every paid step and only those, and gives a media sheet to every step that sends a media', () => {
    for (const step of TRIAL_SCRIPTS.flatMap((script) => script.steps)) {
      expect(step.priceMinor !== null).toBe(step.kind === 'paid');
      expect(step.mediaSheet !== undefined).toBe(step.mediaRefs.length > 0);
    }
  });

  it('names each step once, and finds a script by its ref only', () => {
    const refs = TRIAL_SCRIPTS.flatMap((script) => script.steps.map((step) => step.stepRef));
    expect(new Set(refs).size).toBe(refs.length);
    expect(trialScript('essai-jour')?.moment).toBe('day');
    expect(trialScript('autre')).toBeUndefined();
  });
});
