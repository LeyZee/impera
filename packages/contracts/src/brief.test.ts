import { describe, expect, it } from 'vitest';

import { BRIEF_INTENTS, BriefIntentSchema } from './brief';

describe('brief intents', () => {
  it('is one closed list without a duplicate, `other` last', () => {
    expect(new Set(BRIEF_INTENTS).size).toBe(BRIEF_INTENTS.length);
    expect(BRIEF_INTENTS.at(-1)).toBe('other');
    expect(BriefIntentSchema.safeParse('asks_for_service').success).toBe(true);
    expect(BriefIntentSchema.safeParse('asks_for_money').success).toBe(false);
  });
});
