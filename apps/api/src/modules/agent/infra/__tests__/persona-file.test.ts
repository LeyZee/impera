import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { StoredPersonaSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { guardSettingsOf, personaForModels, readPersonaFile } from '../persona-file';

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
    const settings = guardSettingsOf(demo('v0.7.0'));
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

  it('takes her form from her persona first, then her agency’s base style, then the code (ADR 0173)', () => {
    const settings = guardSettingsOf(demo('v0.7.0'), {
      capitalization: 'capital',
      mark_spacing: 'space',
      emoji_streak_max: 5,
    });
    expect(settings.emojiStreakMax).toBe(3);
    expect(settings.form).toEqual({
      capitalization: 'capital',
      stripFinalPeriod: true,
      markSpacing: 'space',
    });
    expect(guardSettingsOf(demo('v0.5.0')).form).toEqual({
      capitalization: 'free',
      stripFinalPeriod: true,
      markSpacing: 'free',
    });
  });

  it('never tells the model her close-only words: code applies them', () => {
    expect(demo('v0.7.0').personaSheet).not.toContain('close_only_words');
  });
});

describe('her own accounts, to the guards only (Charles 27/11)', () => {
  const withAccounts = (own_accounts: unknown) => {
    const raw: unknown = parse(
      readFileSync(
        fileURLToPath(new URL('../../../../../../../personas/demo/v0.7.0.yaml', import.meta.url)),
        'utf8',
      ),
    );
    const stored = StoredPersonaSchema.parse(raw);
    if (!('agent' in stored)) throw new Error('the demo v0.7.0 is at format 2');
    return personaForModels(
      StoredPersonaSchema.parse({
        ...stored,
        agent: { ...stored.agent, rules: { ...stored.agent.rules, own_accounts } },
      }),
      'Demo',
      '2026-11-27',
    );
  };

  it('carries her typed handles to the guards, never into her sheet for the models (invented handles)', () => {
    const persona = withAccounts({ instagram: '@Exemple.Fictif', tiktok: null });
    expect(guardSettingsOf(persona).ownAccounts).toEqual({ instagram: 'exemple.fictif' });
    expect(persona.personaSheet).not.toContain('exemple.fictif');
    expect(persona.personaSheet).not.toContain('own_accounts');
  });

  it('gives none when none is typed', () => {
    expect(guardSettingsOf(withAccounts({ instagram: null })).ownAccounts).toBeUndefined();
    expect(guardSettingsOf(demo('v0.7.0')).ownAccounts).toBeUndefined();
  });
});
