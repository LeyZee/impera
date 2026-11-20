import { describe, expect, it } from 'vitest';

import { DropMediaDescriptionSchema, MediaDescriptionSchema } from './media';

const PHOTO = {
  vocabularyVersion: '1.0.0',
  kind: 'image',
  factualDescription: 'Une femme en lingerie noire, assise sur un lit, lumière tamisée.',
  durationS: null,
  segments: [],
  intensity: 'suggestive',
  anatomyVisible: ['full_body'],
  castMode: 'solo',
  mood: ['sensual'],
  setting: 'chambre, lumière tamisée',
  audio: null,
  textVisible: null,
  quality: 'good',
  confidenceLow: false,
  notVisible: false,
  flags: [],
};

describe('MediaDescriptionSchema', () => {
  it('accepts a description in the closed vocabulary', () => {
    expect(MediaDescriptionSchema.parse(PHOTO).intensity).toBe('suggestive');
  });

  it('refuses a value outside the vocabulary or another version', () => {
    expect(MediaDescriptionSchema.safeParse({ ...PHOTO, intensity: 'spicy' }).success).toBe(false);
    expect(MediaDescriptionSchema.safeParse({ ...PHOTO, vocabularyVersion: '0.9.0' }).success).toBe(false);
  });
});

describe('DropMediaDescriptionSchema (ADR 0083 § 2, vocabulary 1.1.0)', () => {
  const DROP = { ...PHOTO, vocabularyVersion: '1.1.0', detailed: 'Texte inventé, assez long pour être lu.' };

  it('reads her outfit at the start in the closed vocabulary', () => {
    const outfit = { style: 'lingerie', pieces: [{ type: 'lingerie_top', colours: ['red', 'black'] }] };
    expect(DropMediaDescriptionSchema.parse({ ...DROP, outfit }).outfit).toEqual(outfit);
    expect(DropMediaDescriptionSchema.parse({ ...DROP, outfit: null }).outfit).toBeNull();
    expect(
      DropMediaDescriptionSchema.safeParse({
        ...DROP,
        outfit: { style: 'lingerie', pieces: [{ type: 'lingerie_top', colours: ['bordeaux'] }] },
      }).success,
    ).toBe(false);
    expect(
      DropMediaDescriptionSchema.safeParse({
        ...DROP,
        outfit: { style: 'lingerie', pieces: [{ type: 'lingerie_top', colours: [] }] },
      }).success,
    ).toBe(false);
  });

  it('keeps a description written before the outfit valid as it is, never described again for it', () => {
    const before = DropMediaDescriptionSchema.parse({ ...DROP, vocabularyVersion: '1.0.0' });
    expect(before.outfit).toBeUndefined();
  });
});
