import { describe, expect, it } from 'vitest';

import { startCapOf, startCapTextOf, textsOf, tiersOf } from './model';

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

describe('the cap at a script’s start, as the owner types it', () => {
  // Invented setting: never the agency's own.
  it('shows nothing set as an empty field, and reads an empty field as no cap', () => {
    expect(startCapTextOf({})).toBe('');
    expect(startCapOf('  ')).toEqual({ setting: {} });
  });

  it('reads a comma or a point', () => {
    expect(startCapTextOf({ startCapMultiple: 1.25 })).toBe('1,25');
    expect(startCapOf('1,25')).toEqual({ setting: { startCapMultiple: 1.25 } });
    expect(startCapOf('1.25')).toEqual({ setting: { startCapMultiple: 1.25 } });
  });

  it('refuses a word, a multiple not above one and one past ten', () => {
    for (const text of ['beaucoup', '1', '0,5', '11', '1,2,3'])
      expect(startCapOf(text)).toEqual({
        problem: 'Un multiple au-dessus de 1, jusqu’à 10, ou rien pour couper le plafond.',
      });
  });
});
