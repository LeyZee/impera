import { describe, expect, it } from 'vitest';

import { forbiddenThemeOf } from '../forbidden-themes';
import {
  checkExplicit,
  checkVoiceOutput,
  checkYouthWords,
  DEFAULT_GUARD_SETTINGS,
  type GuardCode,
} from '../guards';
import { safetySigns } from '../safety-net';

/**
 * Permitted phrases that must always pass (Charles 26/11): an adult's words that no guard and no net may stop. Each
 * blocking output guard and each input net has its table here, in French, English, Italian and Spanish where the
 * guard reads them. Every new guard, or a guard made stricter, adds its permitted phrases here in the same change: a
 * guard that catches one of them is too wide, and the guard is fixed, never the phrase. No crude word in this file.
 */

/** The codes the output guards raise on one bubble of hers, out of any history. */
const raised = (bubble: string): GuardCode[] =>
  checkVoiceOutput([bubble], DEFAULT_GUARD_SETTINGS).map((violation) => violation.code);

describe('permitted phrases that must always pass, output guards', () => {
  it.each([
    'fais-moi un bébé',
    'tu vas me mettre enceinte',
    'ma petite robe noire',
    'mon bébé, tu m’as manqué',
    'quand j’étais au lycée, j’étais timide',
    'mes parents habitaient à la campagne',
    'you’ll get me pregnant',
    'my baby, I missed you',
    'piccola mia, che bella giornata',
    'mi bebé, te extrañé',
    't’as des enfants ?',
    'tes gosses ce week-end ?',
    'quand j’étais ado',
    'un détail mineur',
    't’es un grand enfant',
    'je veux porter ton enfant',
    'enfant, j’étais comme ça',
    'quand j’étais petite j’adorais la mer',
    't’étais comment enfant ?',
    'mon enfance à la campagne',
    'have you got kids?',
    'hai figli?',
    '¿tienes hijos?',
  ])('minor_reference lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('minor_reference');
  });

  it.each([
    ['mon bébé, viens là', true],
    ['tu vas me mettre enceinte', true],
    ['my baby, come here', true],
    ['amore mio, vieni qui', true],
    ['cariño, ven aquí', true],
    ['je t’envoie une petite photo', false],
    ['ma petite robe noire te plaît ?', false],
    ['una piccola foto per te', false],
    ['mes petits seins n’attendent que toi', true],
    ['je garde ma petite culotte pour toi', true],
    ['ma petite robe noire glisse', true],
    ['viens mon petit cœur', true],
    ['ma piccola gonna nera', true],
    ['mi pequeña cintura es tuya', true],
    ['ta petite coquine est toute à toi', true],
    ['la mia piccola', true],
    ['ven aquí nena', true],
    ['toute jeune dans ma tête', true],
    ['je veux porter ton enfant', true],
    ['je veux te faire un enfant', true],
  ] as const)('youth_word_in_sex lets « %s » through (sexual turn: %s)', (bubble, sexual) => {
    expect(checkYouthWords([bubble], sexual)).toEqual([]);
  });

  it.each([
    'un baiser sur ta joue',
    'la queue au cinéma était interminable',
    'fais-moi un bébé',
    'un gros câlin pour toi',
    'a kiss for you',
    'un bacio per te',
    'un beso para ti',
  ])('explicit_before_age lets « %s » through', (bubble) => {
    expect(checkExplicit([bubble])).toEqual([]);
  });

  it.each([
    'les nudes c’est pas mon truc',
    'envoie-moi une photo de ton chat',
    'montre-moi ton sourire',
    'dis-moi dans quel état tu es',
    'raconte-moi ce que tu imagines',
  ])('asks_for_nudes lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('asks_for_nudes');
  });

  it.each([
    'on se parle ici, c’est parfait',
    'j’adore Paris au printemps',
    'je rentre vers 21 h',
    'that’s wise of you',
    'ci sentiamo qui',
    'hablamos aquí',
  ])('contact_info lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('contact_info');
  });

  it.each(['je fais pas de promo', 'pas de réduc avec moi 😌', 'il me reste 10 % de batterie'])(
    'discount lets « %s » through',
    (bubble) => {
      expect(raised(bubble)).not.toContain('discount');
    },
  );

  it.each(['pas besoin de payer pour me parler', 'je suis là pour toi'])(
    'payment_lie lets « %s » through',
    (bubble) => {
      expect(raised(bubble)).not.toContain('payment_lie');
    },
  );

  it.each(['petit menteur va 😏', 'tu es adorable', 'quel charmeur'])(
    'contempt lets « %s » through',
    (bubble) => {
      expect(raised(bubble)).not.toContain('contempt');
    },
  );

  it.each(['je suis modèle photo', 'je suis assistante dentaire le jour', 'moi un bot ? tu me vexes'])(
    'ai_disclosure lets « %s » through',
    (bubble) => {
      expect(raised(bubble)).not.toContain('ai_disclosure');
    },
  );
});

describe('permitted phrases that must always pass, input nets', () => {
  it.each([
    'quand j’étais au lycée on faisait pareil',
    'mes parents sont à côté, faut que je fasse gaffe',
    'je suis prof en 3e',
    'mon fils est en 4e',
    'j’ai 16 ans d’expérience dans mon métier',
    'j’ai 34 ans et toi ?',
    'when I was in high school I was shy',
    'da ragazzo giocavo a calcio',
    'cuando era joven jugaba al fútbol',
    'enfant, j’étais comme ça',
    'quand j’étais petit j’adorais la mer',
    't’étais comment enfant ?',
    'mon enfance à la campagne',
  ])('safetySigns finds no minor in « %s »', (text) => {
    expect(safetySigns(text, new Date('2026-11-26T12:00:00Z'))).not.toContain('minor_suspected');
  });

  it.each([
    'je suis mort de rire',
    'ce boulot me tue',
    'je meurs de faim',
    'I’m dying to see you',
    'muoio dalla voglia di vederti',
    'me muero de ganas de verte',
  ])('safetySigns finds no distress in « %s »', (text) => {
    expect(safetySigns(text)).not.toContain('self_harm');
  });

  it.each([
    'je veux te faire un enfant ce soir au lit',
    'te remplir pour te faire un bébé, j’ai envie de toi',
    'tu vas tomber enceinte',
    'j’ai envie de toi ma petite',
    'tu es sexy dans cette petite robe',
    'jeu de rôle prof et étudiante, ça t’excite ?',
    'j’ai envie de toi mon bébé',
    'quand j’étais ado je faisais du foot',
    'marié depuis 15 ans et j’ai envie de toi',
    'I want to make a baby with you in bed',
    'you look sexy in that little dress',
    'voglio farti un figlio a letto',
    'sei sexy, piccola mia',
    'quiero hacerte un bebé en la cama',
    'estás sexy, cariño',
  ])('minor_fantasy leaves « %s »', (text) => {
    expect(safetySigns(text)).not.toContain('minor_fantasy');
  });

  it.each([
    'petite robe',
    'femme mûre',
    'infirmière',
    'bas',
    'lingerie noire',
    'te faire un enfant',
    'te remplir pour te faire un bébé',
    'tomber enceinte',
    'mon bébé',
    'give you a baby',
    'little black dress',
    'farti un figlio',
    'vestito corto',
    'hacerte un bebé',
    'vestido rojo',
  ])('the universal filter leaves « %s » playable', (item) => {
    expect(forbiddenThemeOf(item)).toBeNull();
  });
});
