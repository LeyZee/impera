import { describe, expect, it } from 'vitest';

import { durationTextOf, hoursOf, meetingTiersOf, textsOf, type MeetingTierTexts } from './model';

// Arbitrary durations, chosen only to rise: never a value of the agency.
const SET = { newFanHours: 3 * 24, closeFanHours: 2 * 7 * 24, veryCloseFanHours: 5 * 30 * 24 };

const typed = (
  newFan: string,
  close: string,
  veryClose: string,
  units: readonly ['days' | 'weeks' | 'months', 'days' | 'weeks' | 'months', 'days' | 'weeks' | 'months'] = [
    'days',
    'weeks',
    'months',
  ],
): MeetingTierTexts => ({
  newFanHours: { amount: newFan, unit: units[0] },
  closeFanHours: { amount: close, unit: units[1] },
  veryCloseFanHours: { amount: veryClose, unit: units[2] },
});

describe('her meeting tiers, as the owner types them', () => {
  it('shows empty fields in days, weeks and months while none is set', () => {
    expect(textsOf(null)).toEqual(typed('', '', ''));
  });

  it('converts at typing: a week is 7 days, a month 30 days, all stored in hours', () => {
    expect(hoursOf({ amount: '3', unit: 'days' })).toBe(72);
    expect(hoursOf({ amount: '2', unit: 'weeks' })).toBe(336);
    expect(hoursOf({ amount: '5', unit: 'months' })).toBe(3_600);
    expect(hoursOf({ amount: '1,5', unit: 'days' })).toBe(36);
    expect(meetingTiersOf(typed('3', '2', '5'))).toEqual({ settings: SET });
  });

  it('shows a stored duration in the largest unit it falls on exactly, and reads it back the same', () => {
    expect(durationTextOf(60 * 24)).toEqual({ amount: '2', unit: 'months' });
    expect(durationTextOf(21 * 24)).toEqual({ amount: '3', unit: 'weeks' });
    expect(durationTextOf(10 * 24)).toEqual({ amount: '10', unit: 'days' });
    expect(durationTextOf(36)).toEqual({ amount: '1,5', unit: 'days' });
    for (const hours of [24, 36, 7 * 24, 10 * 24, 30 * 24, 61 * 24, 84 * 24]) {
      expect(hoursOf(durationTextOf(hours))).toBeCloseTo(hours, 6);
    }
    expect(meetingTiersOf(textsOf(SET))).toEqual({ settings: SET });
  });

  it('removes them when the three are left empty', () => {
    expect(meetingTiersOf(typed(' ', '', ''))).toEqual({ settings: null });
  });

  it('refuses a missing or zero duration, and durations that do not rise once converted', () => {
    const missing = { problem: 'Indique dans chaque champ une durée plus grande que zéro.' };
    expect(meetingTiersOf(typed('3', '', '5'))).toEqual(missing);
    expect(meetingTiersOf(typed('0', '2', '5'))).toEqual(missing);
    expect(meetingTiersOf(typed('trois', '2', '5'))).toEqual(missing);
    // 20 days, then 2 weeks: the second is shorter once converted.
    expect(meetingTiersOf(typed('20', '2', '5'))).toEqual({
      problem: 'Chaque durée doit être plus longue que la précédente.',
    });
    // 3 weeks then 20 days: shorter as well, whatever the numbers.
    expect(meetingTiersOf(typed('1', '3', '20', ['days', 'weeks', 'days']))).toEqual({
      problem: 'Chaque durée doit être plus longue que la précédente.',
    });
  });
});
