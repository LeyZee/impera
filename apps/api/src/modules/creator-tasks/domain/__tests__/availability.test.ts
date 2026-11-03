import { describe, expect, it } from 'vitest';

import { availabilityWindows, type Availability } from '../availability';

const PARIS = 'Europe/Paris';
const iso = (windows: readonly { startsAt: Date; endsAt: Date }[]): string[][] =>
  windows.map((window) => [window.startsAt.toISOString(), window.endsAt.toISOString()]);

describe('her dispos as instants (ADR 0042 § 4)', () => {
  const tuesdayEvening: Availability = {
    kind: 'weekly',
    weekday: 2,
    startMinute: 18 * 60,
    endMinute: 22 * 60,
  };

  it('reads a weekly dispo in her wall-clock time, the same hours across the change of time', () => {
    // Paris leaves summer time on Sunday 25 October 2026: 18 h is 16 h UTC before, 17 h UTC after.
    const windows = availabilityWindows([tuesdayEvening], '2026-10-19', '2026-11-01', PARIS);
    expect(iso(windows)).toEqual([
      ['2026-10-20T16:00:00.000Z', '2026-10-20T20:00:00.000Z'],
      ['2026-10-27T17:00:00.000Z', '2026-10-27T21:00:00.000Z'],
    ]);
  });

  it('keeps a dispo that crosses her midnight whole, on the day it starts', () => {
    const late: Availability = { kind: 'weekly', weekday: 6, startMinute: 22 * 60, endMinute: 26 * 60 };
    expect(iso(availabilityWindows([late], '2026-11-07', '2026-11-07', PARIS))).toEqual([
      ['2026-11-07T21:00:00.000Z', '2026-11-08T01:00:00.000Z'],
    ]);
  });

  it('opens the night of the spring change at the first minute that exists', () => {
    // Sunday 28 March 2027 in Paris: 2 h becomes 3 h, a dispo 2 h – 4 h is one hour long.
    const night: Availability = { kind: 'weekly', weekday: 7, startMinute: 2 * 60, endMinute: 4 * 60 };
    expect(iso(availabilityWindows([night], '2027-03-28', '2027-03-28', PARIS))).toEqual([
      ['2027-03-28T01:00:00.000Z', '2027-03-28T02:00:00.000Z'],
    ]);
  });

  it('keeps a dispo once only when it meets the days read, all sorted', () => {
    const once: Availability = {
      kind: 'once',
      startsAt: new Date('2026-11-03T08:00:00.000Z'),
      endsAt: new Date('2026-11-03T10:00:00.000Z'),
    };
    const later: Availability = {
      ...once,
      startsAt: new Date('2026-11-20T08:00:00.000Z'),
      endsAt: new Date('2026-11-20T09:00:00.000Z'),
    };
    expect(
      iso(availabilityWindows([tuesdayEvening, later, once], '2026-11-02', '2026-11-08', PARIS)),
    ).toEqual([
      ['2026-11-03T08:00:00.000Z', '2026-11-03T10:00:00.000Z'],
      ['2026-11-03T17:00:00.000Z', '2026-11-03T21:00:00.000Z'],
    ]);
  });
});
