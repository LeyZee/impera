import { describe, expect, it } from 'vitest';

import { safetySigns } from '../safety-net';

describe('safetySigns (recette AGT-01)', () => {
  it.each([
    'j’ai 16 ans tu sais',
    'jai 15ans',
    'J AI 17 ANS',
    'moi 14 ans et toi ?',
    '16 ans, je suis trop jeune pour toi ?',
    'i’m 16',
    'im 17 lol',
    '15 yo',
    'je suis mineur',
    'je suis encore mineure',
    'je suis au collège',
    'jsuis au collège mdr',
    'chui mineur',
    'je suis en 3ème',
    'je suis en seconde',
    'j’ai pas 18 ans',
    'pas encore majeur',
  ])('reads a minor in « %s »', (text) => {
    expect(safetySigns(text)).toEqual(['minor_suspected']);
  });

  it.each([
    'j’en peux plus, je veux en finir',
    'j’ai envie d’en finir avec la vie',
    'je pense au suicide',
    'je vais me suicider',
    'plus envie de vivre',
    'je veux mourir',
    'je vais me faire du mal',
    'mettre fin à mes jours',
    'I want to die',
  ])('reads self-harm in « %s »', (text) => {
    expect(safetySigns(text)).toEqual(['self_harm']);
  });

  it.each([
    'salut, t’es d’où ?',
    'j’ai 25 ans',
    'j’ai 16 ans d’expérience dans le bâtiment',
    'ma fille a 16 ans',
    'tu as quel âge ? moi 32 ans',
    'j’en peux plus de t’attendre 😏',
    'on en finit quand avec ce suspense ?',
    'je suis en seconde position dans la file',
    'il est 16h, tu fais quoi ?',
    'i’m 18',
  ])('stays quiet on « %s »', (text) => {
    expect(safetySigns(text)).toEqual([]);
  });

  it('says both, the minor first, when he says both', () => {
    expect(safetySigns('j’ai 15 ans et je veux mourir')).toEqual(['minor_suspected', 'self_harm']);
  });
});
