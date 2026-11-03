import { describe, expect, it } from 'vitest';

import { INSTAGRAM_KEYWORDS_MAX, instagramFaults, nudityIn } from './public-outputs';

describe('what a public output never says (ADR 0055 § 1, ADR 0057 § 6)', () => {
  it('finds nudity as whole words, accents and case set aside', () => {
    expect(nudityIn('Photo TOPLESS de dos')).toBe('topless');
    expect(nudityIn('Elle est toute nue')).toBe('nue');
    expect(nudityIn('Une nuée d’oiseaux, un nuage')).toBeNull();
  });

  it('finds what Instagram must not hear', () => {
    expect(instagramFaults('Tout est sur OnlyFans')).toEqual(['adult_platform']);
    expect(instagramFaults('Le lien en bio')).toEqual(['adult_platform']);
    expect(instagramFaults('Va sur www.example.test')).toEqual(['link']);
    expect(instagramFaults('Le pack à 15 €')).toEqual(['price']);
    const tags = Array.from(
      { length: INSTAGRAM_KEYWORDS_MAX + 1 },
      (_, index) => `#mot${String(index)}`,
    ).join(' ');
    expect(instagramFaults(tags)).toEqual(['too_many_keywords']);
    expect(instagramFaults('Une balade au soleil #automne')).toEqual([]);
  });
});
