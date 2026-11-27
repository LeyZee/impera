import { describe, expect, it } from 'vitest';

import { checkVoiceOutput, DEFAULT_GUARD_SETTINGS, isBlocked, type GuardSettings } from '../guards';

// Invented words (CLAUDE.md: no real fan or creator data).
const settings: GuardSettings = {
  ...DEFAULT_GUARD_SETTINGS,
  closeOnlyWords: [
    { words: ['mon cœur'], minTier: 4 },
    { words: ['mon trésor'], minTier: 5 },
  ],
};
const closeWords = (bubbles: string[], fanTier?: number) =>
  checkVoiceOutput(bubbles, settings, fanTier === undefined ? {} : { fanTier }).filter(
    (v) => v.code === 'close_only_word',
  );

describe('close-only words', () => {
  it('blocks a word kept for close fans written to a fan below its tier', () => {
    const violations = checkVoiceOutput(['bonne nuit mon coeur'], settings, { fanTier: 3 });
    expect(violations.filter((v) => v.code === 'close_only_word')).toEqual([
      { code: 'close_only_word', severity: 'blocking', match: 'mon cœur' },
    ]);
    expect(isBlocked(violations)).toBe(true);
  });

  it('lets it through at or above its tier', () => {
    expect(closeWords(['bonne nuit mon cœur'], 4)).toEqual([]);
    expect(closeWords(['bonne nuit mon cœur'], 5)).toEqual([]);
    expect(closeWords(['à demain mon trésor'], 4)).toHaveLength(1);
    expect(closeWords(['à demain mon trésor'], 5)).toEqual([]);
  });

  it('treats a fan whose tier cannot be computed as below every tier', () => {
    expect(closeWords(['bonne nuit mon cœur'])).toHaveLength(1);
    expect(closeWords(['à demain mon trésor'])).toHaveLength(1);
  });

  it('reads the word normalised and whole, across her bubbles', () => {
    expect(closeWords(['Bonne nuit MON CŒUR !'], 1)).toHaveLength(1);
    expect(closeWords(['bonne nuit mon', 'cœur'], 1)).toHaveLength(1);
    expect(closeWords(['mon cœur de pierre fond'], 1)).toHaveLength(1);
    expect(closeWords(['mon cœurdelion'], 1)).toEqual([]);
    expect(closeWords(['ton cœur bat vite'], 1)).toEqual([]);
  });

  it('reads nothing without words of hers', () => {
    expect(
      checkVoiceOutput(['bonne nuit mon cœur'], DEFAULT_GUARD_SETTINGS).map((v) => v.code),
    ).not.toContain('close_only_word');
  });
});
