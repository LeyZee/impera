import { describe, expect, it } from 'vitest';

import { addDays, calendarDayIn, isoWeekday, offsetMinutes, onTheMinute, wallClockToInstant } from '../time';

const iso = (at: Date): string => at.toISOString();

describe('calendar days', () => {
  it('adds days across a month and a year', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('numbers the weekdays the ISO way, Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-11-01')).toBe(7);
  });

  it('reads the day in a zone, not in UTC', () => {
    const lateEvening = new Date('2026-10-27T23:30:00Z');
    expect(calendarDayIn(lateEvening, 'Europe/Paris')).toBe('2026-10-28');
    expect(calendarDayIn(lateEvening, 'Africa/Porto-Novo')).toBe('2026-10-28');
    expect(calendarDayIn(lateEvening, 'America/Martinique')).toBe('2026-10-27');
  });
});

describe('wall-clock time in a zone (contract scheduling.ts)', () => {
  it('reads Paris an hour ahead in winter and two in summer', () => {
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/Paris')).toBe(60);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/Paris')).toBe(120);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Indian/Antananarivo')).toBe(180);
  });

  it('turns an ordinary hour into its instant', () => {
    expect(iso(wallClockToInstant('2026-11-02', 18 * 60, 'Europe/Paris'))).toBe('2026-11-02T17:00:00.000Z');
    expect(iso(wallClockToInstant('2026-07-06', 6 * 60, 'Europe/Paris'))).toBe('2026-07-06T04:00:00.000Z');
  });

  it('moves an hour of the spring gap to the first instant after it: 02:30 is 03:00', () => {
    // Paris jumps from 02:00 to 03:00 on 29 March 2026 (01:00 UTC).
    expect(iso(wallClockToInstant('2026-03-29', 150, 'Europe/Paris'))).toBe('2026-03-29T01:00:00.000Z');
    expect(iso(wallClockToInstant('2026-03-29', 120, 'Europe/Paris'))).toBe('2026-03-29T01:00:00.000Z');
    expect(iso(wallClockToInstant('2026-03-29', 180, 'Europe/Paris'))).toBe('2026-03-29T01:00:00.000Z');
    expect(iso(wallClockToInstant('2026-03-29', 119, 'Europe/Paris'))).toBe('2026-03-29T00:59:00.000Z');
  });

  it('takes the first of the two when an autumn hour happens twice', () => {
    // Paris goes back from 03:00 to 02:00 on 25 October 2026 (01:00 UTC): 02:30 happens at 00:30 and 01:30 UTC.
    expect(iso(wallClockToInstant('2026-10-25', 150, 'Europe/Paris'))).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(wallClockToInstant('2026-10-25', 180, 'Europe/Paris'))).toBe('2026-10-25T02:00:00.000Z');
  });

  it('keeps a zone without a change of time as it is', () => {
    expect(iso(wallClockToInstant('2026-03-29', 150, 'Africa/Porto-Novo'))).toBe('2026-03-29T01:30:00.000Z');
  });

  it('tells an instant on the minute', () => {
    expect(onTheMinute(new Date('2026-11-02T06:00:00Z'))).toBe(true);
    expect(onTheMinute(new Date('2026-11-02T06:00:30Z'))).toBe(false);
    expect(onTheMinute(new Date('2026-11-02T06:00:00.001Z'))).toBe(false);
  });
});
