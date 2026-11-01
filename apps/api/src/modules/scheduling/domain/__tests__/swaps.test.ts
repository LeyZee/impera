import { DomainError } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { assertAnswers, assertColleague, assertOffered, stillAsNoted, swapEnding } from '../swaps';

const at = (value: string): Date => new Date(value);

/** The code a rule throws on these arguments, or `null`. */
function codeOf<Args extends unknown[]>(rule: (...args: Args) => unknown, ...args: Args): string | null {
  try {
    rule(...args);
  } catch (error) {
    return error instanceof DomainError ? error.code : 'unexpected';
  }
  return null;
}

/** Invented members only (ADR 0010). */
const THEO = 'tm_theo';
const BASILE = 'tm_basile';
const now = at('2026-12-24T10:00:00Z');
const shift = {
  memberId: THEO,
  startsAt: at('2026-12-24T22:00:00Z'),
  endsAt: at('2026-12-25T04:00:00Z'),
  cancelled: false,
};

describe('proposing a swap (ADR 0031)', () => {
  it('offers a shift of one’s own that has not started', () => {
    expect(codeOf(assertOffered, shift, THEO, now)).toBeNull();
    expect(codeOf(assertOffered, null, THEO, now)).toBe('shift_not_found');
    expect(codeOf(assertOffered, shift, BASILE, now)).toBe('shift_not_found');
    expect(codeOf(assertOffered, { ...shift, cancelled: true }, THEO, now)).toBe('shift_not_found');
    expect(codeOf(assertOffered, shift, THEO, shift.startsAt)).toBe('shift_started_conflict');
  });

  it('is made with a colleague, never with oneself', () => {
    expect(codeOf(assertColleague, THEO, BASILE)).toBeNull();
    expect(codeOf(assertColleague, THEO, THEO)).toBe('shift_swap_self_invalid');
  });
});

describe('a proposal still holds', () => {
  const noted = { memberId: THEO, startsAt: shift.startsAt, endsAt: shift.endsAt };

  it('while its shift is as noted and ahead', () => {
    expect(stillAsNoted(shift, noted, now)).toBe(true);
  });

  it('no longer once the shift is gone, cancelled, started, or changed hands or hours', () => {
    expect(stillAsNoted(null, noted, now)).toBe(false);
    expect(stillAsNoted({ ...shift, cancelled: true }, noted, now)).toBe(false);
    expect(stillAsNoted(shift, noted, shift.startsAt)).toBe(false);
    expect(stillAsNoted({ ...shift, memberId: BASILE }, noted, now)).toBe(false);
    expect(stillAsNoted({ ...shift, startsAt: at('2026-12-24T23:00:00Z') }, noted, now)).toBe(false);
    expect(stillAsNoted({ ...shift, endsAt: at('2026-12-25T03:00:00Z') }, noted, now)).toBe(false);
  });
});

describe('answering a swap', () => {
  it('is for the colleague asked, on a proposed swap', () => {
    expect(codeOf(assertAnswers, { status: 'proposed', asked: true })).toBeNull();
    expect(codeOf(assertAnswers, { status: 'proposed', asked: false })).toBe('role_forbidden');
    for (const status of ['accepted', 'declined', 'withdrawn', 'lapsed', 'reverted'] as const) {
      expect(codeOf(assertAnswers, { status, asked: true })).toBe('shift_swap_answered_conflict');
    }
  });
});

describe('ending a swap', () => {
  it('lets the requester, the owner or an active manager withdraw a proposed swap', () => {
    expect(swapEnding('self', { status: 'proposed', requested: true })).toBe('withdraw');
    expect(swapEnding('owner', { status: 'proposed', requested: false })).toBe('withdraw');
    expect(swapEnding('agency', { status: 'proposed', requested: false })).toBe('withdraw');
  });

  it('lets the colleague asked decline, never delete', () => {
    expect(codeOf(swapEnding, 'self', { status: 'proposed', requested: false })).toBe('role_forbidden');
  });

  it('lets the owner or an active manager revert an accepted swap, the requester never', () => {
    expect(swapEnding('owner', { status: 'accepted', requested: false })).toBe('revert');
    expect(swapEnding('agency', { status: 'accepted', requested: true })).toBe('revert');
    expect(codeOf(swapEnding, 'self', { status: 'accepted', requested: true })).toBe(
      'shift_swap_answered_conflict',
    );
  });

  it('ends nothing that was declined, withdrawn, lapsed or reverted', () => {
    for (const status of ['declined', 'withdrawn', 'lapsed', 'reverted'] as const) {
      expect(codeOf(swapEnding, 'owner', { status, requested: true })).toBe('shift_swap_answered_conflict');
    }
  });
});
