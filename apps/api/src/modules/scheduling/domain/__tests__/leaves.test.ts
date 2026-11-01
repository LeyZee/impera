import { DomainError } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  assertDecides,
  assertLeaveRange,
  assertLeaveStart,
  leaveCover,
  leaveEnding,
  leaveInstants,
} from '../leaves';

const at = (value: string): Date => new Date(value);
const DAY = 86_400_000;

/** The code a rule throws on these arguments, or `null`. */
function codeOf<Args extends unknown[]>(rule: (...args: Args) => unknown, ...args: Args): string | null {
  try {
    rule(...args);
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
  return null;
}

describe('the instants of a leave (ADR 0031)', () => {
  it('runs from midnight of the first day to midnight after the last, in the member’s zone', () => {
    expect(leaveInstants('2026-12-24', '2026-12-26', 'Europe/Paris')).toEqual({
      startsAt: at('2026-12-23T23:00:00Z'),
      endsAt: at('2026-12-26T23:00:00Z'),
    });
    expect(leaveInstants('2026-12-24', '2026-12-24', 'Africa/Porto-Novo')).toEqual({
      startsAt: at('2026-12-23T23:00:00Z'),
      endsAt: at('2026-12-24T23:00:00Z'),
    });
  });

  it('keeps a day of 23 hours across the spring change of time', () => {
    expect(leaveInstants('2027-03-27', '2027-03-28', 'Europe/Paris')).toEqual({
      startsAt: at('2027-03-26T23:00:00Z'),
      endsAt: at('2027-03-28T22:00:00Z'),
    });
  });
});

describe('asking a leave', () => {
  it('reads a year of leaves at most, and a range that ends after it starts', () => {
    const from = at('2026-11-01T00:00:00Z');
    expect(codeOf(assertLeaveRange, from, new Date(from.getTime() + 366 * DAY))).toBeNull();
    expect(codeOf(assertLeaveRange, from, new Date(from.getTime() + 366 * DAY + 1))).toBe(
      'planning_range_invalid',
    );
    expect(codeOf(assertLeaveRange, from, from)).toBe('planning_range_invalid');
  });

  it('starts today at the earliest', () => {
    expect(codeOf(assertLeaveStart, '2026-11-02', '2026-11-02')).toBeNull();
    expect(codeOf(assertLeaveStart, '2026-11-01', '2026-11-02')).toBe('leave_date_invalid');
  });
});

describe('deciding a leave', () => {
  it('is for the owner and an active manager, on a pending request', () => {
    expect(codeOf(assertDecides, 'owner', { status: 'pending', own: false })).toBeNull();
    expect(codeOf(assertDecides, 'agency', { status: 'pending', own: false })).toBeNull();
    expect(codeOf(assertDecides, 'self', { status: 'pending', own: false })).toBe('role_forbidden');
    expect(codeOf(assertDecides, 'self', { status: 'pending', own: true })).toBe('role_forbidden');
    for (const status of ['approved', 'refused', 'withdrawn', 'cancelled'] as const) {
      expect(codeOf(assertDecides, 'owner', { status, own: false })).toBe('leave_decided_conflict');
    }
  });

  it('never lets a manager decide their own leave; the owner decides theirs, since nobody decides for them', () => {
    expect(codeOf(assertDecides, 'agency', { status: 'pending', own: true })).toBe(
      'leave_own_decision_forbidden',
    );
    expect(codeOf(assertDecides, 'owner', { status: 'pending', own: true })).toBeNull();
  });
});

describe('ending a leave', () => {
  const now = at('2026-12-24T10:00:00Z');
  const ahead = at('2026-12-26T23:00:00Z');

  it('lets the member withdraw their own pending request, whatever their scope', () => {
    for (const scope of ['owner', 'agency', 'self'] as const) {
      expect(leaveEnding(scope, { status: 'pending', own: true, endsAt: ahead }, now)).toBe('withdraw');
    }
  });

  it('refuses a pending request of someone else rather than withdraw it', () => {
    expect(codeOf(leaveEnding, 'agency', { status: 'pending', own: false, endsAt: ahead }, now)).toBe(
      'role_forbidden',
    );
    expect(codeOf(leaveEnding, 'self', { status: 'pending', own: false, endsAt: ahead }, now)).toBe(
      'role_forbidden',
    );
  });

  it('lets the owner or an active manager cancel an approved leave until it ends, the member never', () => {
    expect(leaveEnding('owner', { status: 'approved', own: false, endsAt: ahead }, now)).toBe('cancel');
    expect(leaveEnding('agency', { status: 'approved', own: false, endsAt: ahead }, now)).toBe('cancel');
    // The member's own leave, answered already: said as such, not as a lack of rights.
    expect(codeOf(leaveEnding, 'self', { status: 'approved', own: true, endsAt: ahead }, now)).toBe(
      'leave_decided_conflict',
    );
    expect(codeOf(leaveEnding, 'self', { status: 'refused', own: true, endsAt: ahead }, now)).toBe(
      'leave_decided_conflict',
    );
    expect(codeOf(leaveEnding, 'self', { status: 'approved', own: false, endsAt: ahead }, now)).toBe(
      'role_forbidden',
    );
    expect(codeOf(leaveEnding, 'owner', { status: 'approved', own: false, endsAt: now }, now)).toBe(
      'leave_decided_conflict',
    );
  });

  it('ends nothing that was refused, withdrawn or cancelled', () => {
    for (const status of ['refused', 'withdrawn', 'cancelled'] as const) {
      expect(codeOf(leaveEnding, 'owner', { status, own: false, endsAt: ahead }, now)).toBe(
        'leave_decided_conflict',
      );
    }
  });
});

describe('what a leave covers (ADR 0031)', () => {
  const days = { startsAt: at('2026-12-23T23:00:00Z'), endsAt: at('2026-12-26T23:00:00Z') };

  it('covers its days once approved, and nothing while pending, refused or withdrawn', () => {
    expect(leaveCover({ ...days, status: 'approved', cancelledAt: null })).toEqual(days);
    for (const status of ['pending', 'refused'] as const) {
      expect(leaveCover({ ...days, status, cancelledAt: null })).toBeNull();
    }
    expect(leaveCover({ ...days, status: 'withdrawn', cancelledAt: at('2026-12-20T10:00:00Z') })).toBeNull();
  });

  it('covers the days already taken when cancelled under way, and nothing when cancelled before', () => {
    expect(leaveCover({ ...days, status: 'cancelled', cancelledAt: at('2026-12-25T08:00:00Z') })).toEqual({
      startsAt: days.startsAt,
      endsAt: at('2026-12-25T08:00:00Z'),
    });
    expect(leaveCover({ ...days, status: 'cancelled', cancelledAt: at('2026-12-20T08:00:00Z') })).toBeNull();
    expect(leaveCover({ ...days, status: 'cancelled', cancelledAt: days.startsAt })).toBeNull();
  });
});
