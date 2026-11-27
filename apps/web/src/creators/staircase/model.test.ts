import { describe, expect, it } from 'vitest';

import { settingOf, textsOf } from './model';

// Invented settings: never the agency's own.
describe('the staircase settings, as the owner types them', () => {
  it('shows nothing set as empty fields and reads empty fields as off', () => {
    const texts = textsOf({});
    expect(Object.values(texts).every((text) => text === '')).toBe(true);
    expect(settingOf(texts)).toEqual({ setting: {} });
  });

  it('reads a comma or a point and keeps only what is filled', () => {
    const texts = textsOf({ targetMultiple: 1.7, topTierMinDesire: 90 });
    expect(texts.targetMultiple).toBe('1,7');
    expect(settingOf({ ...texts, startCapMultiple: '1.25' })).toEqual({
      setting: { targetMultiple: 1.7, topTierMinDesire: 90, startCapMultiple: 1.25 },
    });
  });

  it('refuses a word, a multiple not above one and a desire out of its scale', () => {
    const empty = textsOf({});
    expect(settingOf({ ...empty, targetMultiple: 'beaucoup' })).toHaveProperty('problem');
    expect(settingOf({ ...empty, startCapMultiple: '1' })).toHaveProperty('problem');
    expect(settingOf({ ...empty, topTierMinDesire: '101' })).toHaveProperty('problem');
    expect(settingOf({ ...empty, topTierMinDesire: '80,5' })).toHaveProperty('problem');
  });
});
