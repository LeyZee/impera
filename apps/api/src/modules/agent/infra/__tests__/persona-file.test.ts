import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { guardSettingsOf, readPersonaFile } from '../persona-file';

const demo = (version: string) =>
  readPersonaFile(
    readFileSync(
      fileURLToPath(new URL(`../../../../../../../personas/demo/${version}.yaml`, import.meta.url)),
      'utf8',
    ),
    'Demo',
    '2026-11-26',
  );

describe('her close-only words and emoji streak, to the guards (Charles 26/11)', () => {
  it('carries them from her persona to the guards', () => {
    const settings = guardSettingsOf(demo('v0.6.0'));
    expect(settings.closeOnlyWords).toEqual([
      { words: ['Mon cœur'], minTier: 4 },
      { words: ['Mon trésor', 'Ma moitié'], minTier: 5 },
    ]);
    expect(settings.emojiStreakMax).toBe(3);
  });

  it('leaves them out of a persona without them: none kept, the code’s default streak', () => {
    const settings = guardSettingsOf(demo('v0.5.0'));
    expect(settings.closeOnlyWords).toBeUndefined();
    expect(settings.emojiStreakMax).toBeUndefined();
  });

  it('never tells the model her close-only words: code applies them', () => {
    expect(demo('v0.6.0').personaSheet).not.toContain('close_only_words');
  });
});
