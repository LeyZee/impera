import { describe, expect, it } from 'vitest';

import { meetingAnswer, relationshipTier, type MeetingReason, type Relationship } from '../meeting';

const DAY = 24;
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
  it('reads brand new, a few days, a regular who paid, close, very close', () => {
    expect(relationshipTier(fan())).toBe(1);
    expect(relationshipTier(fan({ knownHours: 3 * DAY }))).toBe(2);
    expect(relationshipTier(fan({ hasBought: true }))).toBe(3);
    expect(relationshipTier(fan({ hasBought: true, knownHours: 21 * DAY }))).toBe(4);
    expect(relationshipTier(fan({ hasBought: true, knownHours: 60 * DAY }))).toBe(5);
  });

  it('never takes a fan who never paid past the second tier', () => {
    expect(relationshipTier(fan({ knownHours: 365 * DAY }))).toBe(2);
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
