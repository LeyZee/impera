import { describe, expect, it } from 'vitest';

import { checkPlaceNames, placeNames } from '../place-names';

/** Invented places only (ADR 0010). */
describe('her place names, read from her persona (garde des lieux, ADR 0080 § 5.9)', () => {
  it('keeps the names, folded, and drops the generic words of where she lives', () => {
    expect(placeNames(['Valbrume', 'Un petit appartement sous les toits, quartier de Port-Sénac'])).toEqual([
      'valbrume',
      'port senac',
    ]);
  });

  it('keeps a name of several words whole, and reads nothing from an empty or generic answer', () => {
    expect(placeNames(['Saint-Aubert-des-Brumes'])).toEqual(['saint aubert des brumes']);
    expect(placeNames([null, 'Une maison à la campagne', 'Le'])).toEqual([]);
  });
});

describe('a public text that names one of her places', () => {
  const places = placeNames(['Valbrume', 'Appartement, quartier de Port-Sénac']);
  const codes = (text: string) => checkPlaceNames([text], places);

  it('is blocked, with the name it holds, whatever the accents, the case or a digit for a letter', () => {
    expect(codes('Dimanche à Valbrume ☀️')).toEqual([
      { code: 'place_named', severity: 'blocking', bubbleIndex: 0, match: 'valbrume' },
    ]);
    expect(codes('Vue sur PORT-SENAC ce matin')[0]?.match).toBe('port senac');
    expect(codes('balade à port sénac')).toHaveLength(1);
    expect(codes('Bisous de Valbrum3')).toHaveLength(1);
  });

  it('lets through a text that only shares letters with a name, or a word made from it', () => {
    expect(codes('Une valbrumerie de dimanche')).toEqual([]);
    expect(codes('Le port est calme ce soir')).toEqual([]);
    expect(codes('Ce canapé, cette lumière')).toEqual([]);
  });

  it('names the text of a poll that holds it', () => {
    const violations = checkPlaceNames(['On va où ?', 'La plage', 'Valbrume'], places);
    expect(violations.map((violation) => violation.bubbleIndex)).toEqual([2]);
  });
});
