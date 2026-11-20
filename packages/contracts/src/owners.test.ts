import { describe, expect, it } from 'vitest';

import {
  MAX_OWNERS,
  OWNER_REMOVAL_NOTICE_HOURS,
  ownerCandidateRefusal,
  ownerRemovalEffectiveAt,
  type OwnerCandidateFacts,
} from './owners';

const member: OwnerCandidateFacts = {
  owners: 1,
  role: 'operator',
  activeMember: true,
  secondFactor: true,
  removalPending: false,
};

describe('the owners (ADR 0096)', () => {
  it('accepts an active member of the team whose second factor is active, as the second owner only', () => {
    expect(ownerCandidateRefusal(member)).toBeNull();
    expect(MAX_OWNERS).toBe(2);
    expect(ownerCandidateRefusal({ ...member, owners: 2 })).toBe('full');
    expect(ownerCandidateRefusal({ ...member, owners: 3 })).toBe('full');
  });

  it('refuses a creator’s account, an owner, a member away, and an account without its code', () => {
    expect(ownerCandidateRefusal({ ...member, role: 'creator' })).toBe('not_a_member');
    expect(ownerCandidateRefusal({ ...member, role: 'owner' })).toBe('not_a_member');
    expect(ownerCandidateRefusal({ ...member, activeMember: false })).toBe('not_a_member');
    expect(ownerCandidateRefusal({ ...member, secondFactor: false })).toBe('second_factor_missing');
  });

  it('changes nothing among the owners while a removal waits', () => {
    expect(ownerCandidateRefusal({ ...member, removalPending: true })).toBe('removal_pending');
    // Two owners already is said first: it is the reason that lasts.
    expect(ownerCandidateRefusal({ ...member, owners: 2, removalPending: true })).toBe('full');
  });

  it('gives a removal 72 hours of notice, to the millisecond', () => {
    expect(OWNER_REMOVAL_NOTICE_HOURS).toBe(72);
    expect(ownerRemovalEffectiveAt(new Date('2026-11-20T10:15:30.250Z')).toISOString()).toBe(
      '2026-11-23T10:15:30.250Z',
    );
  });
});
