import { describe, expect, it } from 'vitest';

import { textsOf, tiersOf } from './model';

describe('the tiers of her fans, as the owner types them', () => {
  it('shows the defaults in euros and reads them back in cents', () => {
    const texts = textsOf({ goodFromMinor: 5_000, veryGoodFromMinor: 20_000, whaleFromMinor: 50_000 });
    expect(texts).toEqual({ goodFromMinor: '50', veryGoodFromMinor: '200', whaleFromMinor: '500' });
    expect(tiersOf({ ...texts, goodFromMinor: '49,90' })).toEqual({
      tiers: { goodFromMinor: 4_990, veryGoodFromMinor: 20_000, whaleFromMinor: 50_000 },
    });
  });

  it('refuses an empty amount and thresholds that do not rise', () => {
    expect(tiersOf({ goodFromMinor: '', veryGoodFromMinor: '200', whaleFromMinor: '500' })).toHaveProperty(
      'problem',
    );
    expect(tiersOf({ goodFromMinor: '300', veryGoodFromMinor: '200', whaleFromMinor: '500' })).toEqual({
      problem: 'Chaque palier commence plus haut que le précédent.',
    });
  });
});
