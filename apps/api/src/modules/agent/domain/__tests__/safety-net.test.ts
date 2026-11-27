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

  // ADR 0168 § 4: the same net in Italian, Spanish and English, invented messages.
  it.each([
    'ho 16 anni',
    'io ho quindici anni e tu?',
    'quanti anni ho? ne ho 16',
    '16 anni, sono troppo giovane?',
    'sono minorenne',
    'non ho ancora 18 anni',
    'vado ancora alle medie',
    'faccio la terza media',
    'sto per compiere 18 anni',
    'sono del 2011',
    'tengo 15 años',
    'tengo quince años de edad',
    'soy menor de edad',
    'no tengo 18 años todavía',
    'estoy en tercero de la eso',
    'voy a cumplir 18 el mes que viene',
    'nací en 2012',
    'i am 16',
    'age: 15',
    'i’m still in high school',
    'i’m underage',
    'i’ll be 18 next month',
    'born in 2011',
  ])('reads a minor in « %s » (Italian, Spanish, English)', (text) => {
    expect(safetySigns(text, new Date('2026-11-26T12:00:00Z'))).toEqual(['minor_suspected']);
  });

  it.each([
    'ho 25 anni',
    'ho 16 anni di esperienza',
    'ho 2 figli',
    'mia figlia ha 16 anni',
    'quasi 18 euro, troppo',
    'quando andavo alle medie ero timido',
    'sono del 1990',
    'tengo 30 años',
    'tengo 2 hijos',
    'tengo 15 años de casado',
    'mi hija está en tercero de la eso',
    'i am 30',
    'almost 18 dollars for a coffee',
    'my daughter is in high school',
  ])('stays quiet on « %s » (Italian, Spanish, English)', (text) => {
    expect(safetySigns(text, new Date('2026-11-26T12:00:00Z'))).toEqual([]);
  });

  it.each([
    'voglio farla finita',
    'non ho più voglia di vivere',
    'penso al suicidio',
    'quiero morir',
    'quiero quitarme la vida',
    'no quiero seguir viviendo',
    'i want to end my life',
    'i keep wanting to hurt myself',
  ])('reads self-harm in « %s » (Italian, Spanish, English)', (text) => {
    expect(safetySigns(text)).toEqual(['self_harm']);
  });

  it('says both, the minor first, when he says both', () => {
    expect(safetySigns('j’ai 15 ans et je veux mourir')).toEqual(['minor_suspected', 'self_harm']);
  });
});
