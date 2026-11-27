import { describe, expect, it } from 'vitest';

import { herLabel, rubricsOf } from './my-persona';

describe('a long answer cut on its rubrics (recette visuelle 16/11, CRE-03)', () => {
  it('cuts on rubrics in capitals, at the start of a line or of a sentence, titled in sentence case', () => {
    expect(
      rubricsOf('IDENTITÉ : Une graphiste.\nPERSONNALITÉ : Drôle, directe. VOIX ET STYLE : Phrases courtes.'),
    ).toEqual([
      { title: 'Identité', text: 'Une graphiste.' },
      { title: 'Personnalité', text: 'Drôle, directe.' },
      { title: 'Voix et style', text: 'Phrases courtes.' },
    ]);
  });

  it('keeps what comes before the first rubric, untitled', () => {
    expect(rubricsOf('En bref. IDENTITÉ : Une graphiste. STYLE : Courte.')).toEqual([
      { title: null, text: 'En bref.' },
      { title: 'Identité', text: 'Une graphiste.' },
      { title: 'Style', text: 'Courte.' },
    ]);
  });

  it('leaves an answer with one rubric or none as written', () => {
    expect(rubricsOf('Randonnée, cuisine de rue.')).toBeNull();
    expect(rubricsOf('NOTE : une seule rubrique.')).toBeNull();
    // A capital inside a sentence is not a rubric.
    expect(rubricsOf('Elle vit à Lyon : le centre. Elle aime le TGV : rapide.')).toBeNull();
  });
});

describe('the words of her sheet, said « tu »', () => {
  it('says « tu » where the agency’s questionnaire says « vous », and keeps the rest', () => {
    expect(herLabel('turn_ons', 'Ce qui vous attire')).toBe('Ce qui t’attire');
    expect(herLabel('hobbies', 'Passions')).toBe('Passions');
  });
});
