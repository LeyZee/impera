import { describe, expect, it } from 'vitest';

import { TRIAL_CATALOGUE, TRIAL_SCRIPTS } from '../trial-scripts';

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

  it('shows each step as the platform sends it: its media are the ones the agent reads, a bridge sends none', () => {
    for (const { view, steps } of TRIAL_CATALOGUE) {
      expect(steps).toHaveLength(view.steps.length);
      view.steps.forEach((step, index) => {
        expect(steps[index]?.media.map((media) => media.ref)).toEqual(step.mediaRefs);
        if (step.kind === 'bridge') expect(steps[index]?.media).toEqual([]);
      });
    }
    // Sold by bundle: at least one paid step sends several media, and one shows a teaser before he buys.
    const paid = TRIAL_CATALOGUE.flatMap(({ view, steps }) =>
      steps.filter((_, index) => view.steps[index]?.kind === 'paid'),
    );
    expect(paid.some((step) => step.media.length > 1)).toBe(true);
    expect(paid.some((step) => step.teaser.length > 0)).toBe(true);
  });

  it('names each step and each media once', () => {
    const refs = TRIAL_SCRIPTS.flatMap((script) => script.steps.map((step) => step.stepRef));
    expect(new Set(refs).size).toBe(refs.length);
    const media = TRIAL_CATALOGUE.flatMap(({ steps }) =>
      steps.flatMap((step) => [...step.teaser, ...step.media].map((each) => each.ref)),
    );
    expect(new Set(media).size).toBe(media.length);
  });
});
