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
      staircase: {},
    });
  });

  it('keeps the agency’s staircase as set, no value of its own, and refuses a multiple not above one', () => {
    // Invented settings: never the agency's own.
    const staircase = { targetMultiple: 1.7, topTierMinDesire: 90 };
    expect(CreatorSettingsSchema.parse({ staircase }).staircase).toEqual(staircase);
    expect(CreatorSettingsSchema.safeParse({ staircase: { startCapMultiple: 1 } }).success).toBe(false);
    expect(CreatorSettingsSchema.safeParse({ staircase: { targetMultiple: 1.7, other: 2 } }).success).toBe(
      false,
    );
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
});
