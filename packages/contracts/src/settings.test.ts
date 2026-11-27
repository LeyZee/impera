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
      translateForNets: false,
    });
  });

  it('keeps the translation for the nets off until the owner turns it on (ADR 0168 § 5, 27/11)', () => {
    expect(CreatorSettingsSchema.parse({}).translateForNets).toBe(false);
    expect(CreatorSettingsSchema.parse({ translateForNets: true }).translateForNets).toBe(true);
    expect(CreatorSettingsSchema.safeParse({ translateForNets: 'yes' }).success).toBe(false);
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
