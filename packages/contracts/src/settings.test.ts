import { describe, expect, it } from 'vitest';

import { CreatorSettingsSchema } from './settings';

describe('CreatorSettings', () => {
  it('fills every default from an empty object', () => {
    expect(CreatorSettingsSchema.parse({})).toEqual({
      llm: { roles: {}, contextBudgetTokens: 12_000 },
      autoApproveCategories: [],
      retention: { factMonthsAfterLastContact: 12, fanMediaDays: 30 },
      copilot: { fanCard: true, drafts: false },
      fanTiers: { goodFromMinor: 5_000, veryGoodFromMinor: 20_000, whaleFromMinor: 50_000 },
    });
  });

  it('ignores the retired switch of the descriptions (ADR 0145 § 5, 17/11): a drop is described on arrival', () => {
    expect(CreatorSettingsSchema.parse({ describeDrops: true })).not.toHaveProperty('describeDrops');
  });

  it('keeps an override and ignores the retired identity policy (ADR 0021)', () => {
    const settings = CreatorSettingsSchema.parse({
      llm: { roles: { voice: { provider: 'mistral', model: 'm' } } },
    });
    expect(settings.llm.roles.voice).toEqual({ provider: 'mistral', model: 'm' });
    expect(settings.llm.contextBudgetTokens).toBe(12_000);
    expect(CreatorSettingsSchema.parse({ identityPolicy: 'disclose' })).not.toHaveProperty('identityPolicy');
  });

  it('keeps her meeting tiers only when the three durations rise (guide 26/11), absent by default', () => {
    expect(CreatorSettingsSchema.parse({})).not.toHaveProperty('meetingTiers');
    const meetingTiers = { newFanHours: 3, closeFanHours: 17, veryCloseFanHours: 41 };
    expect(CreatorSettingsSchema.parse({ meetingTiers }).meetingTiers).toEqual(meetingTiers);
    for (const wrong of [
      { newFanHours: 17, closeFanHours: 3, veryCloseFanHours: 41 },
      { newFanHours: 3, closeFanHours: 41, veryCloseFanHours: 41 },
      { newFanHours: 0, closeFanHours: 17, veryCloseFanHours: 41 },
      { newFanHours: 3, closeFanHours: 17 },
    ]) {
      expect(CreatorSettingsSchema.safeParse({ meetingTiers: wrong }).success).toBe(false);
    }
  });
});
