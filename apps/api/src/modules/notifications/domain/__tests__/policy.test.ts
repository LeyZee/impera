import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DAILY_CAP,
  DEFAULT_QUIET_HOURS,
  decideNotification,
  inQuietHours,
  localClock,
  quietHoursEnd,
  type NotificationContext,
} from '../policy';

const PARIS = 'Europe/Paris';

const base: NotificationContext = {
  kind: 'reminder',
  // 15:00 in Paris (winter, UTC+1).
  at: new Date('2026-11-10T14:00:00Z'),
  timeZone: PARIS,
  quiet: DEFAULT_QUIET_HOURS,
  dailyCap: DEFAULT_DAILY_CAP,
  cappedRungToday: 0,
  salesInBurstWindow: 0,
};

describe('quiet hours', () => {
  it('cross midnight by default, start included and end excluded', () => {
    expect(inQuietHours(22 * 60, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(inQuietHours(3 * 60, DEFAULT_QUIET_HOURS)).toBe(true);
    expect(inQuietHours(8 * 60, DEFAULT_QUIET_HOURS)).toBe(false);
    expect(inQuietHours(21 * 60 + 59, DEFAULT_QUIET_HOURS)).toBe(false);
  });

  it('can sit inside a day, or be turned off', () => {
    const nap = { startMinute: 13 * 60, endMinute: 15 * 60 };
    expect(inQuietHours(14 * 60, nap)).toBe(true);
    expect(inQuietHours(16 * 60, nap)).toBe(false);
    expect(inQuietHours(3 * 60, { startMinute: 0, endMinute: 0 })).toBe(false);
  });

  it('are read in the account’s own zone', () => {
    // 23:30 UTC is 00:30 in Paris (quiet) and 18:30 in New York (not quiet).
    const at = new Date('2026-11-10T23:30:00Z');
    expect(quietHoursEnd(at, PARIS, DEFAULT_QUIET_HOURS)?.toISOString()).toBe('2026-11-11T07:00:00.000Z');
    expect(quietHoursEnd(at, 'America/New_York', DEFAULT_QUIET_HOURS)).toBeNull();
    expect(localClock(at, PARIS)).toEqual({ day: '2026-11-11', minute: 30 });
  });

  it('end at 8:00 on the wall clock across the change to summer time', () => {
    // The night of 28 to 29 March 2026: Paris goes from UTC+1 to UTC+2 at 02:00.
    const end = quietHoursEnd(new Date('2026-03-28T23:00:00Z'), PARIS, DEFAULT_QUIET_HOURS);
    expect(end?.toISOString()).toBe('2026-03-29T06:00:00.000Z');
  });
});

describe('decideNotification', () => {
  it('rings a reminder in the day, under the cap', () => {
    expect(decideNotification(base)).toEqual({ action: 'ring' });
  });

  it('holds everything for the recap in the quiet hours, sales too', () => {
    const night = new Date('2026-11-10T23:00:00Z');
    const until = new Date('2026-11-11T07:00:00Z');
    expect(decideNotification({ ...base, at: night })).toEqual({ action: 'hold', until });
    expect(decideNotification({ ...base, kind: 'sale', at: night })).toEqual({ action: 'hold', until });
  });

  it('always rings the start of one’s own shift, night or cap', () => {
    const night = new Date('2026-11-10T23:00:00Z');
    expect(decideNotification({ ...base, kind: 'own_shift_start', at: night, cappedRungToday: 99 })).toEqual({
      action: 'ring',
    });
  });

  it('keeps the rest silent past the daily cap, never a sale', () => {
    expect(decideNotification({ ...base, cappedRungToday: DEFAULT_DAILY_CAP })).toEqual({ action: 'silent' });
    expect(decideNotification({ ...base, kind: 'streak', cappedRungToday: DEFAULT_DAILY_CAP - 1 })).toEqual({
      action: 'ring',
    });
    expect(decideNotification({ ...base, kind: 'sale', cappedRungToday: 99 })).toEqual({ action: 'ring' });
  });

  it('rings each sale, and groups them only past three within two minutes', () => {
    expect(decideNotification({ ...base, kind: 'sale', salesInBurstWindow: 2 })).toEqual({ action: 'ring' });
    expect(decideNotification({ ...base, kind: 'sale', salesInBurstWindow: 3 })).toEqual({ action: 'group' });
  });
});
