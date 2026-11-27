import { describe, expect, it } from 'vitest';

import { forbiddenThemeOf } from '../forbidden-themes';
import {
  checkExplicit,
  checkMoans,
  checkMoodKillers,
  checkVoiceOutput,
  checkYouthWords,
  DEFAULT_GUARD_SETTINGS,
  meetingCommitment,
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
    ['je veux que tu me fasses un enfant', true],
    ['tu me feras un bébé', true],
    ['you’ll give me a baby', true],
    ['mi farai un bambino', true],
    ['me harás un hijo', true],
    ['je mets ma jupe d’écolière pour toi', true],
    ['mon uniforme scolaire te plaît ?', true],
    ['ma tenue de lycéenne, rien que pour toi', true],
    ['my school uniform is on', true],
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
    'je scrollais insta',
    'j’ai pas snap désolé',
    't’as vu ma story insta ?',
    'je poste sur insta vers 21h30',
    'discord c’est pour les gamers non ?',
    'ci sentiamo qui',
    'hablamos aquí',
  ])('contact_info lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('contact_info');
  });

  it.each([
    'tu bosses dans la crypto ?',
    'j’attends le virement de ma paie',
    'pas de paypal ici',
    'j’ai fait un virement à ma mère',
  ])('off_platform_payment lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('off_platform_payment');
  });

  it.each([
    'je t’aime bien toi',
    'j’aime bien ta façon de parler',
    'je t’aime pas quand t’es comme ça',
    'tu dis je t’aime à toutes les filles ?',
    'ma sœur m’a dit je t’aime',
  ])('love_declaration lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('love_declaration');
  });

  it.each([
    'j’ai rdv chez le coiffeur demain',
    'j’ai rendez-vous chez le dentiste',
    'imagine un week-end tous les deux dans un chalet',
    'un jour peut-être, tu me ferais visiter',
    'si on était dans un chalet je te garderais contre moi',
    'on se voit au prochain live',
    'je te réserve une surprise',
    'imagine we were alone in a cabin',
    'je viens chez toi dans mes rêves',
    'on se voit demain ici mon cœur',
    'on se retrouve ce soir sur reveal',
    'je passe à paris demain pour un shooting',
    'je réserve une table pour mon anniv avec mes copines',
    'je cale mon réveil à 7h',
    'on organise un live samedi',
    'on se voit ce soir en live ?',
    'tu viens me voir demain sur mon live ?',
  ])('meeting_promise lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('meeting_promise');
    expect(meetingCommitment(bubble)).toBeUndefined();
  });

  it.each([
    ['avec plaisir', 'tu m’envoies la suite ?'],
    ['ok mais non, pas en vrai', 'samedi à Lyon ?'],
    ['ok mais non', 'samedi à lyon ?'],
    ['ok trop bien', 'samedi je suis à lyon pour le taf'],
    ['avec plaisir', 'on se voit dans tes rêves ce soir ?'],
  ] as const)('meeting_promise lets her « %s » to « %s » through', (bubble, fan) => {
    expect(meetingCommitment(bubble, fan)).toBeUndefined();
  });

  it.each([
    'merci pour ton cadeau 🥰',
    'j’ai une petite surprise pour toi ce soir',
    'merci pour la wishlist, t’es adorable',
    'si tu la prends, dis-moi ce que t’en penses',
    'thank you for the gift',
    'grazie per il regalo',
    'gracias por el regalo',
    'achète des croissants et dis-moi',
  ])('purchase_sweetener lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('purchase_sweetener');
  });

  it.each(['t’es un vilain garçon', 'petit coquin va'])(
    'degrading_word lets « %s » through when her sheet names no word',
    (bubble) => {
      expect(raised(bubble)).not.toContain('degrading_word');
    },
  );

  it.each(['haha', 'oh tu crois ?', 'hmm, raconte'])(
    'moan_below_peak lets « %s » through before the frankest step',
    (bubble) => {
      expect(checkMoans([bubble], false)).toEqual([]);
    },
  );

  it.each(['j’ai tellement envie de toi', 'continue, j’adore', 'tu me rends folle'])(
    'mood_killer lets « %s » through',
    (bubble) => {
      expect(checkMoodKillers([bubble], false)).toEqual([]);
    },
  );

  it.each(['je m’en branle', 'tu sais me toucher avec tes mots'])(
    'explicit_before_age lets « %s » through',
    (bubble) => {
      expect(checkExplicit([bubble])).toEqual([]);
    },
  );

  it.each(['je te retiens, pas tout de suite', 'je retiens mon souffle'])(
    'ai_tic lets « %s » through',
    (bubble) => {
      expect(raised(bubble)).not.toContain('ai_tic');
    },
  );

  it.each([
    ['t’as gagné 100 euros au poker ?', {}],
    ['5 € mon café ce matin', {}],
    ['50 € ? c’est beaucoup pour toi ça 😏', { fanAmountsMinor: [5_000] }],
    ['pour toi c’est 15 euros', { allowedPriceMinor: 1_500 }],
    ['merci pour les 20 € mon cœur 🥰', {}],
  ] as const)('price_outside_offer lets « %s » through', (bubble, context) => {
    expect(checkVoiceOutput([bubble], DEFAULT_GUARD_SETTINGS, context).map((v) => v.code)).not.toContain(
      'price_outside_offer',
    );
  });

  it.each([
    'je fais pas de promo',
    'pas de réduc avec moi 😌',
    'il me reste 10 % de batterie',
    'c’est les soldes, tout est à moitié prix chez zara',
    'promo -20 % sur les jeans ce week-end',
    'en promo à -30 % sur les pulls',
  ])('discount lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('discount');
  });

  it.each(['pas besoin de payer pour me parler', 'je suis là pour toi'])(
    'payment_lie lets « %s » through',
    (bubble) => {
      expect(raised(bubble)).not.toContain('payment_lie');
    },
  );

  it.each([
    'petit menteur va 😏',
    'tu es adorable',
    'quel charmeur',
    'pauvre type celui qui t’a fait ça',
    't’es un menteur, tu m’avais dit demain 😏',
    't’es minable au bowling avoue',
  ])('contempt lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('contempt');
  });

  it.each([
    'je suis modèle photo',
    'je suis assistante dentaire le jour',
    'moi un bot ? tu me vexes',
    't’as essayé chatgpt pour ton taf ?',
    'je suis artificielle ? n’importe quoi',
  ])('ai_disclosure lets « %s » through', (bubble) => {
    expect(raised(bubble)).not.toContain('ai_disclosure');
  });
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
    'je suis au lycée, je suis prof',
    'je suis mineur de fond',
    'j’étais en première quand je t’ai découverte',
    'ma fille est en terminale',
    'en première année de droit',
    'en première année de médecine',
    'en première classe dans le train',
    'en première ligne au taf',
    'arrivé en première… au marathon',
    'en seconde main',
    'première fois que je fais ça',
    'je passe le bac',
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
    'j’ai envie de mourir de rire',
    'je vais me tuer au boulot demain',
    'j’ai envie de crever tellement t’es belle',
  ])('safetySigns finds no distress in « %s »', (text) => {
    expect(safetySigns(text)).not.toContain('self_harm');
  });

  it.each([
    'je veux te faire un enfant ce soir au lit',
    't’es sexy, moi j’ai deux enfants',
    'mes gosses dorment, t’es nue ?',
    'j’ai envie de toi, je dépose mon fils à l’école et je reviens',
    'j’ai été marié 15 ans, j’ai envie de toi',
    'i was horny as a teen',
    'je l’ai prise ce matin, les enfants étaient chez mamie',
    'je l’ai prise pendant que les enfants dormaient',
    'j’ai envie de voir ma fille ce week-end',
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
    'daddy',
    'appelle-moi papa',
  ])('the universal filter leaves « %s » playable', (item) => {
    expect(forbiddenThemeOf(item)).toBeNull();
  });
});
