import { describe, expect, it } from 'vitest';

import { publicDescriptionOf } from '../channel-visual';
import { handDescription } from '../describe';

const photo = { kind: 'image' as const, durationMs: null };

describe('her channel’s visuals: never any nudity (ADR 0162 § 5.2)', () => {
  it('keeps a soft or suggestive medium, with its factual sentence', () => {
    expect(publicDescriptionOf(handDescription(photo, 'Elle sourit en lingerie noire.', 'suggestive'))).toBe(
      'Elle sourit en lingerie noire.',
    );
  });

  it('leaves out an explicit medium, a flagged one and one whose words say nudity', () => {
    expect(publicDescriptionOf(handDescription(photo, 'Elle sourit.', 'explicit'))).toBeNull();
    expect(
      publicDescriptionOf({ ...handDescription(photo, 'Elle sourit.', 'soft'), flags: ['possible_minor'] }),
    ).toBeNull();
    expect(
      publicDescriptionOf({
        ...handDescription(photo, 'Elle sourit.', 'soft'),
        anatomyVisible: ['genitals'],
      }),
    ).toBeNull();
    expect(publicDescriptionOf(handDescription(photo, 'Elle pose nue sur le lit.', 'soft'))).toBeNull();
    // A description the model was not sure of: in doubt, no visual.
    expect(
      publicDescriptionOf({ ...handDescription(photo, 'Elle sourit.', 'soft'), confidenceLow: true }),
    ).toBeNull();
  });

  it('leaves out a description it cannot read', () => {
    expect(publicDescriptionOf({ kind: 'image' })).toBeNull();
    expect(publicDescriptionOf(null)).toBeNull();
  });
});
