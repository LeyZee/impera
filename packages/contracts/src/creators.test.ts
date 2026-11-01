import { describe, expect, it } from 'vitest';

import { CREATOR_ERROR_CODES, creatorNameKey, NewCreatorSchema } from './creators';

describe('NewCreatorSchema', () => {
  const name = (displayName: string) => NewCreatorSchema.safeParse({ displayName });

  it('takes a name with a letter, trimmed, in any script', () => {
    expect(name('  Zoé  ').data?.displayName).toBe('Zoé');
    for (const ok of ['Lou', 'Ana-Maria', 'Mia 2', 'Ελένη', 'ナナ']) expect(name(ok).success).toBe(true);
  });

  it('refuses a name without a letter: empty, invisible, punctuation or digits alone', () => {
    for (const refused of ['', '   ', '​', '​‍', '...', '—', '!!!', '2024', '🙂']) {
      expect(name(refused).success).toBe(false);
    }
    expect(name('a'.repeat(81)).success).toBe(false);
  });
});

describe('creatorNameKey', () => {
  it('reads one name whatever the case, accents, invisible characters and spaces', () => {
    const zoe = creatorNameKey('Zoé');
    for (const same of ['zoe', 'ZOÉ', ' Zoe ', 'Zoé', 'Zo​é', 'ｚｏｅ']) {
      expect(creatorNameKey(same)).toBe(zoe);
    }
    expect(creatorNameKey('Ana  Maria')).toBe(creatorNameKey('ana maria'));
  });

  it('keeps names apart that differ by a letter', () => {
    expect(creatorNameKey('Zoé')).not.toBe(creatorNameKey('Zoey'));
    expect(creatorNameKey('Ana Maria')).not.toBe(creatorNameKey('AnaMaria'));
  });
});

describe('CREATOR_ERROR_CODES', () => {
  it('gives every code a suffix that sets its status (api.md)', () => {
    for (const code of CREATOR_ERROR_CODES) expect(code).toMatch(/_(not_found|conflict)$/u);
  });
});
