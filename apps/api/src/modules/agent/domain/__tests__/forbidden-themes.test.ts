import { describe, expect, it } from 'vitest';

import { EMPTY_DESIRE_MAP, rankByFantasy } from '../fantasy-match';
import { forbiddenThemeOf, withoutForbiddenThemes } from '../forbidden-themes';

describe('forbiddenThemeOf (Sécurité, #1043)', () => {
  it.each([
    ['tenue d’écolière', 'youth'],
    ['jeu de rôle prof-élève mineure', 'youth'],
    ['uniforme scolaire', 'youth'],
    ['schoolgirl outfit', 'youth'],
    ['qu’elle fasse la jeunette', 'youth'],
    ['belle-mère', 'family'],
    ['jeu de rôle avec sa demi-sœur', 'family'],
    ['stepsister roleplay', 'family'],
    ['qu’elle soit endormie', 'no_consent'],
    ['contre son gré', 'no_consent'],
    ['drugged', 'no_consent'],
    ['addormentata', 'no_consent'],
    ['avec un animal', 'animal'],
    ['perro', 'animal'],
    ['avoir une enfant', 'youth'],
    ['jouer une fille de 15 ans au lit', 'youth'],
  ])('filters « %s » (%s)', (item, theme) => {
    expect(forbiddenThemeOf(item)).toBe(theme);
  });

  it.each([
    'petite robe',
    'femme mûre',
    'infirmière',
    'bas',
    'lingerie noire',
    'jeu de rôle au bureau',
    'talons',
    'je veux te faire un enfant',
    'te remplir pour te faire un bébé',
    'tu vas tomber enceinte',
    'give you a baby',
    'hacerte un bebé',
    'farti un figlio',
  ])('leaves « %s »', (item) => {
    expect(forbiddenThemeOf(item)).toBeNull();
  });
});

describe('withoutForbiddenThemes', () => {
  it('drops a forbidden item from what is played, and keeps his limits', () => {
    const map = {
      ...EMPTY_DESIRE_MAP,
      desires: ['belle-mère', 'femme mûre'],
      outfits: ['tenue d’écolière', 'petite robe', 'bas'],
      wordsThatWork: ['infirmière', 'endormie'],
      limits: ['belle-mère'],
    };
    expect(withoutForbiddenThemes(map)).toEqual({
      ...map,
      desires: ['femme mûre'],
      outfits: ['petite robe', 'bas'],
      wordsThatWork: ['infirmière'],
    });
  });

  it('never takes a forbidden item as a script target, nor leaves it uncovered for the voice', () => {
    const scripts = [
      { description: 'Pack de démonstration', steps: [] },
      { description: 'Elle joue la belle-mère en tenue d’écolière', steps: [] },
    ];
    const map = { ...EMPTY_DESIRE_MAP, desires: ['belle-mère'], outfits: ['tenue d’écolière'] };
    const { ranked, uncovered } = rankByFantasy(scripts, map);
    expect(ranked.map((one) => one.matches)).toEqual([[], []]);
    expect(ranked.map((one) => one.script.description)).toEqual([
      'Pack de démonstration',
      'Elle joue la belle-mère en tenue d’écolière',
    ]);
    expect(uncovered).toEqual([]);
  });
});
