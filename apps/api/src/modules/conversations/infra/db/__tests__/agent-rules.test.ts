import { describe, expect, it } from 'vitest';

import { agentRulesOf } from '../fan-standing';

// Arbitrary durations, chosen only to rise: never a value of the agency.
const MEETING_TIERS = { newFanHours: 3, closeFanHours: 17, veryCloseFanHours: 41 };

describe('her rules for the agent, read from her stored settings', () => {
  it('gives her meeting tiers as the owner stored them', () => {
    expect(agentRulesOf({ meetingTiers: MEETING_TIERS })).toEqual({ meetingTiers: MEETING_TIERS });
  });

  it('gives nothing when none is set: nobody goes past the second tier, nobody is a time-waster', () => {
    for (const settings of [undefined, null, {}, { fanTiers: {} }]) {
      expect(agentRulesOf(settings)).toEqual({});
    }
  });

  it('gives nothing from settings that no longer read, durations that do not rise included', () => {
    expect(agentRulesOf({ meetingTiers: { ...MEETING_TIERS, closeFanHours: 2 } })).toEqual({});
    expect(agentRulesOf({ meetingTiers: { newFanHours: 3 } })).toEqual({});
    expect(agentRulesOf('broken')).toEqual({});
  });
});
