import { describe, expect, it } from 'vitest';

import { explicitPhotoAnswer, fanStanding, proofAnswer } from '../standing';

const LIMITS = { timeWasterHours: 500 };

describe('where he stands with her (Charles 21/11)', () => {
  it('is a payer once he paid, a time-waster only past the agency’s span with nothing paid, new otherwise', () => {
    expect(fanStanding({ knownHours: 900, hasBought: true }, LIMITS)).toBe('payer');
    expect(fanStanding({ knownHours: 900, hasBought: false }, LIMITS)).toBe('time_waster');
    expect(fanStanding({ knownHours: 10, hasBought: false }, LIMITS)).toBe('new');
    // Without the setting, nobody is a time-waster.
    expect(fanStanding({ knownHours: 900, hasBought: false })).toBe('new');
  });

  it('answers his explicit photo by where he stands, never sexual before his age is confirmed', () => {
    expect(explicitPhotoAnswer('payer', true)).toBe('turned_on');
    expect(explicitPhotoAnswer('new', true)).toBe('calm_down');
    expect(explicitPhotoAnswer('time_waster', true)).toBe('mock');
    expect(explicitPhotoAnswer('payer', false)).toBe('calm_down');
  });

  it('passes his asking for a proof on, refused only to a time-waster', () => {
    expect(proofAnswer('new')).toBe('relay');
    expect(proofAnswer('payer')).toBe('relay');
    expect(proofAnswer('time_waster')).toBe('refuse');
  });
});
