import { describe, expect, it } from 'vitest';

import { ACTIVITY_REFRESH_MS, lifetimeOf, LONGEST_IDLE_MS, sessionEnd } from '../session-lifetime';

const NOW = new Date('2026-11-20T12:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('session lifetime by role (SEC-17)', () => {
  it('gives the owner 48 hours idle and 7 days, the creator 7 days idle and 30 days, an operator 12 hours and 7 days', () => {
    expect(lifetimeOf('owner')).toEqual({ idleMs: 48 * HOUR, maxAgeMs: 7 * DAY });
    expect(lifetimeOf('creator')).toEqual({ idleMs: 7 * DAY, maxAgeMs: 30 * DAY });
    expect(lifetimeOf('operator')).toEqual({ idleMs: 12 * HOUR, maxAgeMs: 7 * DAY });
    // Better Auth keeps a session as long as the longest idle, the creator's.
    expect(LONGEST_IDLE_MS).toBe(7 * DAY);
  });

  it('gives a role that does not validate the short lifetime', () => {
    for (const role of [undefined, null, '', 'Owner', 'admin', 42, ['owner']]) {
      expect(lifetimeOf(role)).toEqual(lifetimeOf('operator'));
    }
  });

  it('keeps each role just under its idle limit and ends it just past', () => {
    for (const [role, idle] of [
      ['owner', 48 * HOUR],
      ['creator', 7 * DAY],
      ['operator', 12 * HOUR],
      ['unknown', 12 * HOUR],
    ] as const) {
      // Opened just before its last activity: well within its age limit.
      const session = (ms: number) => ({ role, createdAt: ago(ms + HOUR), lastActiveAt: ago(ms) });
      expect(sessionEnd(session(idle - HOUR), NOW)).toBeNull();
      expect(sessionEnd(session(idle + HOUR), NOW)).toBe('idle');
    }
  });

  it('reads an operator’s inactivity within the minute: active 11 h 59 ago kept, idle 12 h 01 closed (PRO2-10)', () => {
    expect(ACTIVITY_REFRESH_MS).toBeLessThanOrEqual(MINUTE);
    for (const role of ['operator', 'unknown'] as const) {
      // His last request `idle` ago; its refresh written up to one refresh earlier (the worst case) or then.
      const at = (idle: number, late: number) => ({
        role,
        createdAt: ago(idle + HOUR),
        lastActiveAt: ago(idle + late),
      });
      expect(sessionEnd(at(12 * HOUR - MINUTE, ACTIVITY_REFRESH_MS - 1), NOW)).toBeNull();
      expect(sessionEnd(at(12 * HOUR - MINUTE, 0), NOW)).toBeNull();
      expect(sessionEnd(at(12 * HOUR + MINUTE, 0), NOW)).toBe('idle');
      expect(sessionEnd(at(12 * HOUR + MINUTE, ACTIVITY_REFRESH_MS - 1), NOW)).toBe('idle');
    }
  });

  it('ends a session past its role’s age, however much it is used', () => {
    for (const [role, maxAge] of [
      ['owner', 7 * DAY],
      ['creator', 30 * DAY],
      ['operator', 7 * DAY],
    ] as const) {
      const used = (age: number) => ({ role, createdAt: ago(age), lastActiveAt: ago(MINUTE) });
      expect(sessionEnd(used(maxAge - HOUR), NOW)).toBeNull();
      expect(sessionEnd(used(maxAge + MINUTE), NOW)).toBe('max_age');
    }
  });
});
