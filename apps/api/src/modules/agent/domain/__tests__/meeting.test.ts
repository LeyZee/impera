import { describe, expect, it } from 'vitest';

import { meetingAnswer, relationshipTier, type MeetingReason, type Relationship } from '../meeting';

const fan = (over: Partial<Relationship> = {}): Relationship => ({
  knownHours: 2,
  hasBought: false,
  ...over,
});
const turn = (tier: number, given: MeetingReason[] = [], teased = false) => ({
  tier,
  given,
  teased,
  herNextParty: false,
});

describe('relationshipTier (guide 26/11): seniority and purchases, never his insisting', () => {
  // Fictional settings: hers are typed by the owner, never written in the repo.
  const settings = { newFanHours: 10, closeFanHours: 100, veryCloseFanHours: 1_000 };
  it('reads brand new, a few days, a regular who paid, close, very close', () => {
    expect(relationshipTier(fan(), settings)).toBe(1);
    expect(relationshipTier(fan({ knownHours: 10 }), settings)).toBe(2);
    expect(relationshipTier(fan({ hasBought: true }), settings)).toBe(3);
    expect(relationshipTier(fan({ hasBought: true, knownHours: 100 }), settings)).toBe(4);
    expect(relationshipTier(fan({ hasBought: true, knownHours: 1_000 }), settings)).toBe(5);
  });

  it('never takes a fan who never paid past the second tier', () => {
    expect(relationshipTier(fan({ knownHours: 100_000 }), settings)).toBe(2);
  });

  it('takes nobody past the second tier without her settings', () => {
    expect(relationshipTier(fan({ hasBought: true, knownHours: 100_000 }), undefined)).toBe(2);
    expect(relationshipTier(fan({ knownHours: 100_000 }), undefined)).toBe(1);
  });
});

describe('meetingAnswer', () => {
  it('gives the reason of his tier first, then the ones below, never one above nor one already given', () => {
    expect(meetingAnswer(turn(1))).toEqual({ kind: 'reason', reason: 'too_early' });
    expect(meetingAnswer(turn(3))).toEqual({ kind: 'reason', reason: 'secret' });
    expect(meetingAnswer(turn(3, ['secret']))).toEqual({ kind: 'reason', reason: 'needs_time' });
    expect(meetingAnswer(turn(5, ['safety', 'no_dates']))).toEqual({ kind: 'reason', reason: 'secret' });
  });

  it('teases once when every reason of his tier was given, then it is the fan who insists', () => {
    expect(meetingAnswer(turn(1, ['too_early']))).toEqual({ kind: 'tease' });
    expect(meetingAnswer(turn(1, ['too_early'], true))).toEqual({ kind: 'heavy' });
    // A reason above his tier given before (he was closer then) does not count for his tier now.
    expect(meetingAnswer(turn(2, ['safety', 'needs_time']))).toEqual({ kind: 'reason', reason: 'too_early' });
  });

  it('answers his question about her next party apart, whatever was given', () => {
    expect(meetingAnswer({ ...turn(1, ['too_early'], true), herNextParty: true })).toEqual({
      kind: 'next_party',
    });
  });
});
