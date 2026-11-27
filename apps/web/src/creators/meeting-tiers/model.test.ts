import { describe, expect, it } from 'vitest';

import { meetingTiersOf, textsOf } from './model';

// Arbitrary durations, chosen only to rise: never a value of the agency.
const SET = { newFanHours: 3, closeFanHours: 17.5, veryCloseFanHours: 41 };

describe('her meeting tiers, as the owner types them', () => {
  it('shows nothing when none is set, and her durations in hours otherwise', () => {
    expect(textsOf(null)).toEqual({ newFanHours: '', closeFanHours: '', veryCloseFanHours: '' });
    expect(textsOf(SET)).toEqual({ newFanHours: '3', closeFanHours: '17,5', veryCloseFanHours: '41' });
    expect(meetingTiersOf(textsOf(SET))).toEqual({ settings: SET });
  });

  it('removes them when the three are left empty', () => {
    expect(meetingTiersOf({ newFanHours: ' ', closeFanHours: '', veryCloseFanHours: '' })).toEqual({
      settings: null,
    });
  });

  it('refuses a missing or zero duration, and durations that do not rise', () => {
    expect(meetingTiersOf({ newFanHours: '3', closeFanHours: '', veryCloseFanHours: '41' })).toEqual({
      problem: 'Un nombre d’heures par palier, plus que zéro.',
    });
    expect(meetingTiersOf({ newFanHours: '0', closeFanHours: '17', veryCloseFanHours: '41' })).toHaveProperty(
      'problem',
    );
    expect(
      meetingTiersOf({ newFanHours: 'trois', closeFanHours: '17', veryCloseFanHours: '41' }),
    ).toHaveProperty('problem');
    expect(meetingTiersOf({ newFanHours: '3', closeFanHours: '41', veryCloseFanHours: '17' })).toEqual({
      problem: 'Chaque durée est plus longue que la précédente.',
    });
  });
});
