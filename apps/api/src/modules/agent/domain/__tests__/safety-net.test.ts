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
    'j’ai seize ans',
    'jai dix-sept ans',
    'moi 16 piges',
    'je vais avoir 18 ans le mois prochain',
    'bientôt 18 ans',
    'en 4e',
    'je suis lycéen',
    'lycéenne et toi ?',
    'je suis au lycée',
    'je suis en terminale',
    'j’ai 16 balais',
    'je suis en 4e, et toi ?',
    'bientôt 18 ans 😏',
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
    'j’ai envie de me foutre en l’air',
    'je pense à m’ouvrir les veines',
    'j’ai des idées noires ce soir',
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
    'j’ai 30 piges',
    'quand j’étais lycéen j’étais timide',
    'je suis en 3e année de licence',
    'on est arrivés en 3e position',
    'je suis né en 1994',
    'je suis en première ligne au boulot',
    'j’ai un fils en 4e',
    'ma fille est lycéenne',
    'ma fille est née en 2012',
    'mon fils né en 2015',
    'la boîte est née en 2020',
    'je suis prof en 3e',
    'bientôt 18 h, tu fais quoi ?',
    'presque 18 degrés ici',
    'j’ai presque 18 ans de mariage',
    'j’ai bientôt 18 ans de boîte',
    'on est en 4e de finale',
    'je suis en terminale de ma formation',
    'moi dix ans que j’habite ici',
    'j’ai 5 balais devant la porte',
    'j’ai des idées noires pour le scénario',
  ])('stays quiet on « %s »', (text) => {
    expect(safetySigns(text)).toEqual([]);
  });

  it('reads a birth year against the current year', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(safetySigns('je suis né en 2011', now)).toEqual(['minor_suspected']);
    expect(safetySigns('née en 2008', now)).toEqual(['minor_suspected']);
    expect(safetySigns('je suis né en 2007', now)).toEqual([]);
  });

  it('says both, the minor first, when he says both', () => {
    expect(safetySigns('j’ai 15 ans et je veux mourir')).toEqual(['minor_suspected', 'self_harm']);
  });
});

describe('a fantasy of his on minors, on a direct link only (Charles 26/11 at 23:45, Sécurité #1043)', () => {
  // One sober sentence per pattern, by language: a sexual verb onto a minor, a desire onto one in a sexual message, a
  // minor's role asked of her, « t'as 16 ans ? » in a sexual message.
  it.each([
    ['fr', 'je veux toucher une ado'],
    ['fr', 'je fantasme sur une écolière'],
    ['fr', 'j’ai envie d’une gamine, je suis tout excité'],
    ['fr', 'joue une collégienne pour moi'],
    ['fr', 't’as 16 ans ? tu m’excites'],
    ['en', 'I want to touch a teen'],
    ['en', 'roleplay a schoolgirl for me'],
    ['it', 'voglio toccare una ragazzina'],
    ['it', 'hai 16 anni? mi ecciti'],
    ['es', 'quiero tocar a una niña'],
    ['es', 'disfrázate de colegiala'],
  ])('%s: takes « %s »', (_language, text) => {
    expect(safetySigns(text)).toContain('minor_fantasy');
  });

  it.each([
    // A father, a memory of his, a length of time (Sécurité's false alarms).
    't’es sexy, moi j’ai deux enfants',
    'mes gosses dorment, t’es nue ?',
    'j’ai envie de toi, je dépose mon fils à l’école et je reviens',
    'j’ai été marié 15 ans, j’ai envie de toi',
    'i was horny as a teen',
    // Procreation between adults, in the present, the subjunctive and the future.
    'je veux te faire un enfant ce soir au lit',
    'je veux que tu me fasses un enfant',
    'te remplir pour te faire un bébé, j’ai envie de toi',
    'tu vas tomber enceinte',
    'I want to give you a baby in bed',
    'voglio che tu mi faccia un figlio',
    'quiero que me hagas un bebé',
    // Words for her, a dress, an adult game of age.
    'j’ai envie de toi ma petite',
    'tu es sexy dans cette petite robe',
    'jeu de rôle prof et étudiante, ça t’excite ?',
    'j’ai envie de toi mon bébé',
    'quand j’étais ado je faisais du foot',
    'sei sexy, piccola mia',
    'estás sexy, cariño',
  ])('leaves « %s »', (text) => {
    expect(safetySigns(text)).not.toContain('minor_fantasy');
  });
});
