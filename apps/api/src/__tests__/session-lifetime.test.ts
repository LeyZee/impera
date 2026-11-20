import { describe, expect, it } from 'vitest';

import {
  idleLimitMs,
  LONG_IDLE_MS,
  LONG_IDLE_ROLES,
  SESSION_MAX_AGE_MS,
  sessionEnd,
  SHORT_IDLE_MS,
} from '../session-lifetime';

const NOW = new Date('2026-11-20T12:00:00Z');
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('session lifetime by role (SEC-17)', () => {
  it('gives the owner and the creator 48 hours without activity, an operator 12', () => {
    expect(SHORT_IDLE_MS).toBe(12 * HOUR);
    expect(LONG_IDLE_MS).toBe(48 * HOUR);
    expect(idleLimitMs('owner')).toBe(LONG_IDLE_MS);
    expect(idleLimitMs('creator')).toBe(LONG_IDLE_MS);
    expect(idleLimitMs('operator')).toBe(SHORT_IDLE_MS);
    expect([...LONG_IDLE_ROLES].sort()).toEqual(['creator', 'owner']);
  });

  it('gives a role that does not validate the short idle', () => {
    for (const role of [undefined, null, '', 'Owner', 'admin', 42, ['owner']]) {
      expect(idleLimitMs(role)).toBe(SHORT_IDLE_MS);
    }
  });

  it('keeps an owner or a creator idle 47 hours and ends one idle 49 hours', () => {
    for (const role of ['owner', 'creator']) {
      const session = (idle: number) => ({ role, createdAt: ago(3 * 24 * HOUR), lastActiveAt: ago(idle) });
      expect(sessionEnd(session(47 * HOUR), NOW)).toBeNull();
      expect(sessionEnd(session(49 * HOUR), NOW)).toBe('idle');
    }
  });

  it('keeps an operator idle 11 hours and ends one idle 13 hours', () => {
    for (const role of ['operator', 'unknown']) {
      const session = (idle: number) => ({ role, createdAt: ago(24 * HOUR), lastActiveAt: ago(idle) });
      expect(sessionEnd(session(11 * HOUR), NOW)).toBeNull();
      expect(sessionEnd(session(13 * HOUR), NOW)).toBe('idle');
    }
  });

  it('ends any session 7 days after its creation, however much it is used', () => {
    for (const role of ['owner', 'operator', 'creator']) {
      const used = (age: number) => ({ role, createdAt: ago(age), lastActiveAt: ago(MINUTE) });
      expect(sessionEnd(used(6 * 24 * HOUR), NOW)).toBeNull();
      expect(sessionEnd(used(SESSION_MAX_AGE_MS + MINUTE), NOW)).toBe('max_age');
    }
  });
});
