import { describe, expect, it } from 'vitest';

import { CreatorSettingsSchema } from './settings';

describe('CreatorSettings', () => {
  it('fills every default from an empty object', () => {
    expect(CreatorSettingsSchema.parse({})).toEqual({
      llm: { roles: {}, contextBudgetTokens: 12_000 },
      autoApproveCategories: [],
      retention: { factMonthsAfterLastContact: 12, fanMediaDays: 30 },
      // Off until the agency has checked the vision model on her real media (ADR 0083 § 9).
      describeDrops: false,
      copilot: { fanCard: true, drafts: false },
    });
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
