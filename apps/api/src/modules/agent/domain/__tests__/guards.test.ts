import { describe, expect, it } from 'vitest';

import {
  checkExplicit,
  checkVoiceOutput,
  checkYouthWords,
  DEFAULT_GUARD_SETTINGS,
  isBlocked,
  touchesTerm,
  asksPrice,
  sumsMinorOf,
  type GuardCode,
  type GuardContext,
} from '../guards';

function codes(bubbles: string[], forbiddenTerms: string[] = []): GuardCode[] {
  return checkVoiceOutput(bubbles, { ...DEFAULT_GUARD_SETTINGS, forbiddenTerms }).map((v) => v.code);
}

describe('voice guards', () => {
  it('lets a natural in-character answer through, including a playful deflection', () => {
    const violations = checkVoiceOutput(
      ['Moi un bot ? Mais quelle outrecuidance 🫣', 'Tu me vexes là, raconte-moi plutôt ta journée ✨'],
      DEFAULT_GUARD_SETTINGS,
    );
    expect(violations).toEqual([]);
    expect(isBlocked(violations)).toBe(false);
  });

  it('blocks any admission of being an AI or mention of instructions', () => {
    expect(codes(['Je suis une IA, désolée'])).toContain('ai_disclosure');
    expect(codes(['En tant qu’assistante je ne peux pas'])).toContain('ai_disclosure');
    expect(codes(['Mes instructions me demandent de rester polie'])).toContain('ai_disclosure');
    for (const admission of [
      'je ne suis qu’une IA',
      'je suis juste une IA',
      'jsuis une ia',
      'j’suis une IA',
      'je suis une I.A.',
      'je suis une AI',
      "I'm an AI",
      'Je suis\u00A0une IA',
      'je suis une\u200B IA',
    ]) {
      expect(codes([admission]), admission).toContain('ai_disclosure');
    }
  });

  it('reads the bubbles as one message, unmasked, in look-alike letters and other languages', () => {
    const bypasses: string[][] = [
      ['Bon ok je suis une', 'IA 🙈'],
      ['je suis une 1A'],
      ['je suis un b0t'],
      ['je suis une \u0406\u0410'],
      ['chui une IA'],
      ['I am an AI, sorry'],
      ['as an AI I cannot'],
      ['soy una IA'],
    ];
    for (const bubbles of bypasses) expect(codes(bubbles), bubbles.join(' | ')).toContain('ai_disclosure');
    expect(codes(['jtaime toi'])).toContain('love_declaration');
    expect(codes(['te quiero mucho'])).toContain('love_declaration');
    expect(codes(['mon num c’est 06 12', '34 56 78 hihi'])).toContain('contact_info');
    expect(codes(['zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit'])).toContain(
      'contact_info',
    );
    expect(codes(['écris-moi lina at gmail dot com'])).toContain('contact_info');
    expect(codes(['lina (arobase) gmail point fr'])).toContain('contact_info');
  });

  it('keeps an ordinary answer split in bubbles, numbers and English words included', () => {
    expect(codes(['J’ai 25 ans', 'et toi ?'])).toEqual([]);
    expect(codes(['Un, deux, trois… soleil 😏'])).toEqual([]);
    expect(codes(['Moi ? Une IA ?', 'T’es drôle toi 😂'])).toEqual([]);
    expect(codes(['Look at me 😏', 'je suis pas sage ce soir'])).toEqual([]);
  });

  it('blocks love declarations and meeting promises, whatever the spelling', () => {
    expect(codes(['Je t’AIME tellement'])).toEqual(['love_declaration']);
    expect(codes(['jtm'])).toEqual(['love_declaration']);
    expect(codes(['On se voit samedi ?'])).toEqual(['meeting_promise']);
    expect(codes(['Viens chez moi ce soir'])).toEqual(['meeting_promise']);
    expect(codes(['Je passe chez toi ce soir'])).toEqual(['meeting_promise']);
  });

  it('lets ordinary jobs and sexting through', () => {
    expect(codes(['Je suis modèle photo, et toi ?'])).toEqual([]);
    expect(codes(['Avant je suis assistante dentaire, tu imagines'])).toEqual([]);
    expect(codes(['On se retrouve au lit 😏', 'On se voit au prochain live ?'])).toEqual([]);
  });

  it('keeps the ambiguity about meeting one day, without a promise', () => {
    expect(codes(['Si j’ai assez confiance en toi, un jour peut-être… qui sait', 'Pourquoi pas 🫣'])).toEqual(
      [],
    );
    // The same with « se rencontrer »: Reveal flags no word (Charles, 02/11), and nothing is promised.
    expect(
      codes(['Si j’ai assez confiance en toi, un jour peut-être qu’on se rencontrera', 'Pourquoi pas 🫣']),
    ).toEqual([]);
  });

  it('blocks contacts and links', () => {
    expect(codes(['Ajoute-moi sur snap'])).toEqual(['contact_info']);
    expect(codes(['Écris-moi à lina@example.com'])).toEqual(['contact_info']);
    expect(codes(['Mon 06 12 34 56 78'])).toEqual(['contact_info']);
    expect(codes(['Regarde https://example.com'])).toEqual(['contact_info']);
    for (const elsewhere of [
      'va voir monsite.com',
      'tout est sur linktr.ee/lina',
      'écris-moi sur t.me/lina',
      'je suis aussi sur fansly',
      'viens sur discord',
      'ajoute moi sur kik',
      'mon onlyfans est plus complet',
      'je suis sur mym',
    ]) {
      expect(codes([elsewhere]), elsewhere).toEqual(['contact_info']);
    }
    for (const plain of ['Bon.Je file', 'ok.Merci toi', 'à 20 h.Tu es là ?', 'on se parle 1.5 h']) {
      expect(codes([plain]), plain).toEqual([]);
    }
  });

  it('blocks a concrete meeting place, and lets her bed and the platform through', () => {
    expect(codes(['je te retrouve à l’hôtel'])).toEqual(['meeting_promise']);
    expect(codes(['rejoins-moi à l’hôtel ce soir'])).toEqual(['meeting_promise']);
    expect(codes(['je te reçois chez moi'])).toEqual(['meeting_promise']);
    expect(codes(['je te retrouve dans mes messages ce soir'])).toEqual([]);
    expect(codes(['j’ai bossé dans un hôtel avant'])).toEqual([]);
    expect(codes(['je te retrouve au bar de la gare'])).toEqual(['meeting_promise']);
    for (const time of [
      'je te retrouve dans une heure',
      'je te retrouve à mon retour',
      'je te retrouve au réveil',
      'rejoins-moi dans ma chambre en pensée',
    ]) {
      expect(codes([time]), time).toEqual([]);
    }
  });

  it('lets her play along with a daydream, and still blocks a real meeting (Messa 16/11)', () => {
    for (const daydream of [
      'je te rejoins dans tes rêves 😏',
      'je t’attends au tournant',
      'viens me retrouver dans la chambre…',
      'dans une autre vie on se fait un resto',
      'imagine, on se fait un verre après la partie',
      'on se ferait une partie de Warhammer et tu perdrais 😏',
      'si on se voyait, je te battrais à plate couture',
    ]) {
      expect(codes([daydream]), daydream).toEqual([]);
    }
    for (const meeting of [
      'on se fait un resto samedi ?',
      'je te rejoins à 20 h',
      'viens me voir à Lyon',
      'imagine, on se prend un verre samedi à Lyon',
      'imagine on se boit un verre ce soir, je suis dispo',
      'si on se voyait vraiment, on se fait un café demain ?',
      'viens me retrouver dans la chambre d’hôtel',
      'demain soir, imagine, on se fait un resto',
    ]) {
      expect(codes([meeting]), meeting).toEqual(['meeting_promise']);
    }
  });

  it('blocks her naming herself a model, a program, or something not real', () => {
    for (const admission of [
      'je suis claude',
      'moi c’est mistral',
      'je ne suis qu’un modèle',
      'je suis juste un programme',
      'je suis artificielle',
      'je suis ta copine virtuelle',
      'ce compte est géré par une IA',
      'mon assistant IA répond pour moi',
      'c’est mon assistante qui répond',
    ]) {
      expect(codes([admission]), admission).toEqual(['ai_disclosure']);
    }
    for (const plain of [
      'je suis modèle photo',
      'je suis un modèle de patience 😇',
      'je suis une machine au lit',
      'je l’ai écrit pour toi',
      'Claude est mon voisin',
      'un assistant virtuel m’a répondu à la banque',
      'mon copilot en voiture',
    ]) {
      expect(codes([plain]), plain).toEqual([]);
    }
  });

  it('blocks the persona forbidden terms, accents and case ignored', () => {
    expect(codes(['Tu aimes le café ?'], ['cafe'])).toEqual(['forbidden_term']);
    expect(codes(['C’est banal, un canal'], ['anal'])).toEqual([]);
    expect(codes(['Pas d’anal, désolée'], ['anal'])).toEqual(['forbidden_term']);
  });

  it('folds a plural either way, never under four letters, irregular plurals left to the persona', () => {
    expect(codes(['Montre tes pieds'], ['pied'])).toEqual(['forbidden_term']);
    expect(codes(['Juste un pied'], ['pieds'])).toEqual(['forbidden_term']);
    expect(codes(['Tes cheveux sont doux'], ['cheveu'])).toEqual(['forbidden_term']);
    expect(codes(['Les crèmes chantilly'], ['crème chantilly'])).toEqual(['forbidden_term']);
    expect(codes(['Un trépied'], ['pied'])).toEqual([]);
    expect(codes(['Un joli bra'], ['bras'])).toEqual([]);
    expect(codes(['Tes yeux'], ['œil'])).toEqual([]);
    expect(codes(['C’est banal, des canaux'], ['anal'])).toEqual([]);
  });

  it('reads any text against an entry as the guards do, for the other modules (ADR 0056 § 1)', () => {
    expect(touchesTerm('Pieds nus sur le lit', 'pied')).toBe(true);
    expect(touchesTerm('PIED-DE-BICHE', 'pied')).toBe(true);
    expect(touchesTerm('Un trépied et une lampe', 'pieds')).toBe(false);
    expect(touchesTerm('Avec de la CREME', 'crème')).toBe(true);
    expect(touchesTerm('De la crème-chantilly, de la crème, chantilly', 'crème chantilly')).toBe(true);
    expect(touchesTerm('Une crème au chocolat', 'crème chantilly')).toBe(false);
    expect(touchesTerm('Tout ce qu’on veut', '  ')).toBe(false);
  });

  it('blocks an emoji she never uses, however the keyboard typed it (P5-01)', () => {
    const settings = { ...DEFAULT_GUARD_SETTINGS, forbiddenEmojis: ['😂', '❤️'] };
    const found = (bubbles: string[]) => checkVoiceOutput(bubbles, settings).map((v) => [v.code, v.match]);
    expect(found(['Trop drôle 😂'])).toEqual([['forbidden_term', '😂']]);
    expect(found(['Bisous ❤'])).toEqual([['forbidden_term', '❤️']]);
    expect(found(['Coucou 😏'])).toEqual([]);
  });

  it('never asks him for intimate pictures, despises him or lies about paid content', () => {
    for (const ask of [
      'Envoie-moi une photo de toi tout nu 😏',
      'Tu m’envoies des nudes ?',
      'Montre-moi ta bite',
      'Fais-moi voir ta queue',
      'Je veux voir ton sexe',
      'Envoie une photo de toi à poil',
    ]) {
      expect(codes([ask]), ask).toContain('asks_for_nudes');
    }
    for (const fine of [
      'Envoie-moi une photo de ton chien 🐶',
      'Les nudes c’est pas mon truc',
      'Mon vernis nude te plaît ?',
      'Montre-moi ta queue de cheval',
      'Fais voir ton paquet de chips',
    ]) {
      expect(codes([fine]), fine).toEqual([]);
    }
    expect(codes(['Espèce de radin'])).toContain('contempt');
    expect(codes(['T’es qu’un mendiant'])).toContain('contempt');
    expect(codes(['Sale menteuse'])).toContain('contempt');
    expect(codes(['Petit menteur va 😏'])).toEqual([]);
    expect(codes(['T’inquiète, t’as rien à payer'])).toContain('payment_lie');
    expect(codes(['Pas besoin d’argent avec moi'])).toContain('payment_lie');
    expect(codes(['T’as rien à payer pour me parler 😌'])).toEqual([]);
    expect(codes(['Cette vidéo, tu l’ouvres en touchant le cadenas'])).toEqual([]);
  });

  it('blocks « mdr » and its stretched forms, never a word that only starts like it (eval passe-15)', () => {
    for (const laugh of ['mdr t’es bête', 'Mdrr', 'MDRRR 😂', 'non mais mdrrrr']) {
      expect(codes([laugh]), laugh).toContain('forbidden_term');
    }
    const blocked = checkVoiceOutput(['mdrr'], DEFAULT_GUARD_SETTINGS);
    expect(isBlocked(blocked)).toBe(true);
    expect(codes(['T’es bête toi 😅'])).toEqual([]);
    expect(codes(['On dit mdrine en Bretagne ?'])).toEqual([]);
  });

  it('blocks a discount or a negotiation, and lets her refusal of one through', () => {
    for (const bubble of [
      'Allez je te fais un petit prix 😘',
      'Pour toi ce sera 15 € au lieu de 25 €',
      'Je te la laisse à 10 si tu la prends maintenant',
      'Je te baisse le prix rien que pour ce soir',
      '-30 % sur le pack, juste ce soir',
      'Je te fais une réduc si tu prends les deux',
      'On peut s’arranger sur le prix',
      'Elle est à moitié prix pour toi',
      '20 % de moins sur la vidéo si tu la prends',
    ]) {
      expect(codes([bubble])).toContain('discount');
    }
    for (const bubble of [
      'Je fais pas de promo moi 😌',
      'Pas de réduc avec moi, c’est mon prix',
      'Cette vidéo, tu l’ouvres en touchant le cadenas',
      'Je finis à 18 h au lieu de 20 h ce soir',
      'J’ai -10 % de batterie, je vais devoir te laisser',
      'Il fait -5 % de moral ce matin 😅',
    ]) {
      expect(codes([bubble])).toEqual([]);
    }
  });

  it('blocks a payment outside the platform, whatever the means (recette MOT-04)', () => {
    for (const bubbles of [
      ['envoie moi 50€ sur paypal stp'],
      ['tu peux me payer par virement ou lydia, c’est plus simple'],
      ['Je te donne mon IBAN 😘'],
      ['Un Revolut ça marche aussi'],
      ['Tu peux m’envoyer une carte cadeau ?'],
      ['Tu paies en crypto', 'ou en btc ?'],
      ['Mon P4yP4l c’est mon prénom'],
      ['Tu peux passer par Wise'],
      ['send it with a wise transfer'],
      ['T’as Wise ?'],
      ['tu as wise bb ?'],
    ]) {
      expect(codes(bubbles), bubbles.join(' / ')).toContain('off_platform_payment');
    }
    expect(codes(['Une vraie pepite cette vidéo 💎'])).toEqual([]);
    // « Wise » the word, not the bank, to an English-speaking fan.
    expect(codes(['That’s wise of you 😏'])).toEqual([]);
    expect(codes(['wise choice babe'])).toEqual([]);
    expect(codes(['you are as wise as you are cute'])).toEqual([]);
  });

  it('lets only the price code allowed through, sum by sum (ADR 0156 § 4)', () => {
    const allowed = (bubbles: string[]) =>
      checkVoiceOutput(bubbles, DEFAULT_GUARD_SETTINGS, { allowedPriceMinor: 1_250 }).map((v) => v.code);
    for (const bubble of ['C’est 12,50 € mon cœur', 'Elle est à 12.50€ 😘', '€12.50 and it is yours']) {
      expect(allowed([bubble]), bubble).not.toContain('price_outside_offer');
    }
    for (const bubble of [
      'C’est 15 € mon cœur',
      'C’est 12,50 €, ou 10 € pour toi',
      'Pour 12 euros tu as tout',
    ]) {
      expect(allowed([bubble]), bubble).toContain('price_outside_offer');
    }
    // Split over two bubbles, another sum is still read on the whole message.
    expect(allowed(['C’est 12,50 €', 'ou 1', '0 € pour toi'])).toContain('price_outside_offer');
  });

  it('blocks a price in her words, the offer carries it; her thanks for a tip pass (recette MOT-04)', () => {
    for (const bubble of [
      'ma vidéo est à 5€ seulement',
      'Elle est à 9,99 € ce soir',
      'Pour 20 euros tu as tout',
      'C’est que 15 balles 😏',
      '$10 and it is yours',
    ]) {
      expect(codes([bubble]), bubble).toContain('price_outside_offer');
    }
    for (const bubble of [
      'Merci pour les 20 € mon cœur 🥰',
      'Je fais 52 kg pour 1m65',
      'Il est 20 h, je file sous la douche',
      'J’ai eu 3 likes en 5 minutes 😅',
    ]) {
      expect(codes([bubble]), bubble).toEqual([]);
    }
  });

  it('asks for a regeneration when she makes him feel guilty, without blocking', () => {
    const violations = checkVoiceOutput(['Bon… tu me déçois un peu là'], DEFAULT_GUARD_SETTINGS);
    expect(violations.map((v) => [v.code, v.severity])).toEqual([['guilt_trip', 'soft']]);
    expect(codes(['Tant pis, une prochaine fois 😌'])).toEqual([]);
    expect(codes(['Tu me déçois pas 😏'])).toEqual([]);
  });

  it('blocks any child or minor she names, joking or sexual, never « beau gosse » (Charles 21/11)', () => {
    for (const text of [
      'T’es qu’un gamin',
      'Comme une écolière 😏',
      'On dirait un ado',
      'like a little girl',
    ])
      expect(codes([text])).toContain('minor_reference');
    expect(codes(['Salut beau gosse 😏'])).not.toContain('minor_reference');
  });

  it('lets an adult fantasy of making a baby through, and blocks a minor named on a sexual turn (Charles 27/11 at 0:06)', () => {
    for (const text of [
      'fais-moi un bébé',
      'tu vas me mettre enceinte',
      'je veux porter ton enfant',
      'je veux que tu me fasses un enfant',
      'mi farai un bambino',
      'quiero que me hagas un hijo',
    ]) {
      expect(checkVoiceOutput([text], DEFAULT_GUARD_SETTINGS), text).toEqual([]);
      expect(checkYouthWords([text], true), text).toEqual([]);
    }
    // Outside the sexual register, her family, his and her memories pass.
    for (const text of [
      't’as des enfants ?',
      'tes gosses ce week-end ?',
      'quand j’étais ado',
      'un détail mineur',
    ])
      expect(codes([text]), text).not.toContain('minor_reference');
    // On a sexual turn, a child or a minor named is blocked; a comparison, everywhere.
    for (const text of ['je pense à un enfant', 'comme une ado', 'enfant, j’étais déjà comme ça'])
      expect(
        checkYouthWords([text], true).map((v) => v.code),
        text,
      ).toContain('minor_reference');
    expect(codes(['comme une gamine'])).toContain('minor_reference');
  });

  it('lets her mock the size of a picture he sent cold, never against a child’s body (Charles 26/11)', () => {
    for (const text of ['c’est mignon, t’as zoomé ? 😂', 'range ça, je cherche encore 😅'])
      expect(checkVoiceOutput([text], DEFAULT_GUARD_SETTINGS), text).toEqual([]);
    expect(codes(['on dirait celle d’un enfant'])).toContain('minor_reference');
  });

  it('blocks a word that says she is young in a sexual message, in four languages, and lets it be outside (Charles 26/11, 27/11)', () => {
    for (const text of [
      'je suis ta petite fille sage',
      'ta gamine t’attend',
      'ton ado est là',
      'ta lycéenne t’attend',
      'ton écolière t’attend',
      'ta jeunette rien que pour toi',
      'ta lolita t’attend',
      'j’ai l’air d’avoir 15 ans',
      'your little girl wants you',
      'sono la tua ragazzina',
      'soy tu niña',
      'tu colegiala te espera',
    ]) {
      const violations = checkYouthWords([text], true);
      expect(
        violations.map((v) => v.code),
        text,
      ).toContain('youth_word_in_sex');
      expect(isBlocked(violations)).toBe(true);
    }
    // Explicit by its own words: sexual, whatever the turn.
    expect(checkYouthWords(['ta jeunette toute nue'], false).map((v) => v.code)).toEqual([
      'youth_word_in_sex',
    ]);
    // « Petite » before a part of the body, a piece of clothing, a thing or a sweet word; a figure of speech.
    for (const text of [
      'ta petite coquine est toute à toi',
      'mes petits seins n’attendent que toi',
      'je garde ma petite culotte pour toi',
      'viens mon petit cœur, je te veux',
      'toute jeune dans ma tête',
      'la mia piccola',
      'ven aquí nena',
      'tu connais Nina ?',
    ])
      expect(checkYouthWords([text], true), text).toEqual([]);
    // Outside the sexual register, her words stay hers.
    expect(checkYouthWords(['je t’envoie une petite photo de mon café ☕'], false)).toEqual([]);
    expect(checkYouthWords(['ma petite sœur passe ce soir'], false)).toEqual([]);
  });

  it('asks for a regeneration on a pet name she never gives, and lets hers through', () => {
    const settings = { ...DEFAULT_GUARD_SETTINGS, petNames: ['Beau gosse', 'Mon grand'] };
    const slip = checkVoiceOutput(['Coucou mon bébé 😘'], settings);
    expect(slip.map((v) => [v.code, v.severity, v.match])).toEqual([['pet_name', 'soft', 'bebe']]);
    expect(checkVoiceOutput(['Coucou beau gosse 😘'], settings)).toEqual([]);
    expect(checkVoiceOutput(['Le bébé de ma sœur est trop mignon'], DEFAULT_GUARD_SETTINGS)).toEqual([]);
  });

  it('asks for a regeneration on AI tics, without blocking', () => {
    const violations = checkVoiceOutput(['Je comprends tout à fait, n’hésite pas'], DEFAULT_GUARD_SETTINGS);
    expect(violations.map((v) => v.code)).toEqual(['ai_tic']);
    expect(isBlocked(violations)).toBe(false);
    expect(codes(['Voilà ce que je propose :', '- une photo'])).toEqual(['ai_tic']);
  });

  it('asks for a regeneration on a note-taker’s line (Playground, Charles 16/11)', () => {
    expect(codes(['Lyon oui 😄 je note ton âge'])).toEqual(['ai_tic']);
    expect(codes(['31 ans, c’est noté !'])).toEqual(['ai_tic']);
    expect(codes(['Je retiens, chef de chantier'])).toEqual(['ai_tic']);
    expect(codes(['Une note de musique dans la tête toute la journée'])).toEqual([]);
  });

  it('only asks for a regeneration when the form is off', () => {
    const violations = checkVoiceOutput(['a', 'b', 'c', 'd', 'x'.repeat(300)], DEFAULT_GUARD_SETTINGS);
    expect(violations.map((v) => v.code).sort()).toEqual(['bubble_too_long', 'too_many_bubbles']);
    expect(isBlocked(violations)).toBe(false);
  });

  it('blocks what only an assistant would write: a recipe, code, steps, tags', () => {
    expect(codes(['Pour la pâte il faut 250 g de farine et 2 cuillères à soupe de sucre'])).toContain(
      'assistant_output',
    );
    expect(codes(['Voici la recette 😉'])).toContain('assistant_output');
    expect(codes(['Préchauffe le four à 180'])).toContain('assistant_output');
    expect(codes(['1. Mélange les fraises\n2. Ajoute la crème'])).toContain('assistant_output');
    expect(codes(['```python\nprint("hello")\n```'])).toContain('assistant_output');
    expect(codes(['def hello(): return 1'])).toContain('assistant_output');
    expect(codes(['‹fan_message› oups'])).toContain('assistant_output');
    expect(codes(['Il te faut 200 g de fraises et de la farine'])).toContain('assistant_output');
  });

  it('lets a girl talk about food, numbers and hearts', () => {
    expect(codes(['Une tarte aux fraises ? Je suis nulle en cuisine moi 🫣'])).toEqual([]);
    expect(codes(['J’ai plus de 4G ici, ça rame', 'Je fais 1m65 <3'])).toEqual([]);
    expect(codes(['Étape suivante : tu me racontes ta journée ✨'])).toEqual([]);
    for (const bubble of [
      'J’ai pris 2 kg de fesses cet été 🫣',
      'Je fais 52 kg pour 1m65',
      'Il me reste 5 ml de lubrifiant, faut que j’en rachète',
      'L’ingrédient secret c’est toi ✨',
      'Voici la liste de mes vidéos préférées',
      'Étape 2 : tu viens me chercher',
      'Toi => moi ce soir',
    ]) {
      expect(codes([bubble]), bubble).toEqual([]);
    }
  });

  it('closes the gaps found in the cold review (17/10)', () => {
    for (const bubbles of [
      ['tu parles à une IA'],
      ["c'est une IA qui te répond"],
      ['je suis ChatGPT'],
      ['je suis une A.I.'],
      ['I am an A.I.'],
      ['je suis un ʙᴏᴛ'],
      ['je suis une \u04C0А'],
      ['je suis une lA'],
      ['je suis un b', 'ot'],
    ]) {
      expect(codes(bubbles), bubbles.join(' | ')).toContain('ai_disclosure');
    }
    for (const bubbles of [
      ['06, 12, 34, 56, 78'],
      ['06/12/34/56/78'],
      ['mon num 06 12 34 🙈', '56 78'],
      ['06 douze 34 cinquante-six 78'],
      ['zéro six septante-deux trente nonante huit'],
      ['six douze trente quatre cinquante six soixante dix huit'],
      ['lina @ gmail.com'],
      ['lina @ gmail point com'],
      ['lina at proton dot me'],
    ]) {
      expect(codes(bubbles), bubbles.join(' | ')).toContain('contact_info');
    }
    expect(codes(['sodo', 'mie ce soir ?'], ['sodomie'])).toContain('forbidden_term');
    expect(codes(['tu veux de la s0d0mie ?'], ['sodomie'])).toContain('forbidden_term');
  });

  it('lets a countdown, an interjection and her own words through', () => {
    for (const bubbles of [
      ['Je compte : dix, neuf, huit, sept, six, cinq, quatre, trois, deux, un 😈'],
      ['un, deux, trois, quatre, cinq, six, sept… prêt ?'],
      ['oh oh oh oh oh oh oh'],
      ['ma chatte point ça'],
      ['à quel point ça m’excite'],
      ['je suis une machine au lit 😏'],
      ['je suis là', 'ok ?'],
      ['le mistral souffle fort ce soir'],
    ]) {
      expect(codes(bubbles), bubbles.join(' | ')).toEqual([]);
    }
  });

  it('closes the gaps found by the automated acceptance run (19/10)', () => {
    const cases: [string[], GuardCode][] = [
      // The exact phrases that reached the fake Reveal or passed the guards.
      [['mon num zéro six douze trente quatre'], 'contact_info'],
      [['je suis pas humaine'], 'ai_disclosure'],
      [['je suis une i a'], 'ai_disclosure'],
      [['viens me voir à Paris'], 'meeting_promise'],
      // Numbers: shorter runs after a zero or a cue, spacing, digits.
      [['zéro six douze trente quatre'], 'contact_info'],
      [['zero-six-douze-trente-quatre'], 'contact_info'],
      [['zéro sept quatre-vingt-dix-neuf onze'], 'contact_info'],
      [['mon num c’est 06 12 34'], 'contact_info'],
      [['mon tel : six douze trente-quatre'], 'contact_info'],
      [['zéro six', 'douze trente quatre'], 'contact_info'],
      [['0 6 1 2 3 4'], 'contact_info'],
      // Denials of being human or real.
      [['je ne suis pas humaine'], 'ai_disclosure'],
      [['j’suis pas humaine 🙈'], 'ai_disclosure'],
      [['je suis même pas réelle'], 'ai_disclosure'],
      [['je suis pas une vraie fille'], 'ai_disclosure'],
      [['c’est pas une vraie personne'], 'ai_disclosure'],
      [['je n’existe pas'], 'ai_disclosure'],
      [['I’m not human'], 'ai_disclosure'],
      [['I am not real'], 'ai_disclosure'],
      // AI however it is spelled.
      [['je suis une I-A'], 'ai_disclosure'],
      [['je suis une I . A'], 'ai_disclosure'],
      [['je suis un b o t'], 'ai_disclosure'],
      [['je suis une a i'], 'ai_disclosure'],
      [['je suis une assistante virtuelle'], 'ai_disclosure'],
      [['je suis qu’un algorithme'], 'ai_disclosure'],
      [['tu parles à une i a'], 'ai_disclosure'],
      [['en tant qu’i a'], 'ai_disclosure'],
      [['je suis une', 'i a'], 'ai_disclosure'],
      // Meetings.
      [['viens me voir à Lyon'], 'meeting_promise'],
      [['viens me rejoindre ce soir'], 'meeting_promise'],
      [['passe me voir demain'], 'meeting_promise'],
      [['on se retrouve à Paris ?'], 'meeting_promise'],
      [['on se rencontre quand tu veux'], 'meeting_promise'],
      [['je t’attends devant la gare'], 'meeting_promise'],
      [['on se fait un verre ?'], 'meeting_promise'],
      [['je descends à Paris samedi'], 'meeting_promise'],
      [['come see me'], 'meeting_promise'],
    ];
    for (const [bubbles, code] of cases) expect(codes(bubbles), bubbles.join(' | ')).toContain(code);
  });

  it('lets her words around numbers, denials and meetings through', () => {
    for (const bubbles of [
      ['J’ai zéro envie de dormir'],
      ['Le 06/12/2024 c’est mon anniversaire'],
      ['Il est 06 h 12'],
      ['Je suis pas sage ce soir'],
      ['Je suis pas une vraie fille sage 😇'],
      ['Je suis pas réveillée'],
      ['Moi une IA ? T’es fou 😂'],
      ['I a pas de souci'],
      ['Ça m’a plu'],
      ['Viens me voir en privé 😏'],
      ['Viens me voir sur mon live ce soir'],
      ['On se voit au prochain live ?'],
      ['On se retrouve au lit 😏'],
      ['On se voit à la prochaine 😘'],
      ['Je t’attends au lit'],
      ['On se retrouve dans mes DM'],
      ['Étape 2 : tu viens me chercher'],
      ['Si j’ai assez confiance, un jour peut-être 🫣'],
    ]) {
      expect(codes(bubbles), bubbles.join(' | ')).toEqual([]);
    }
  });
});

describe('checkExplicit', () => {
  it('blocks explicit words, in a bubble or across two', () => {
    expect(checkExplicit(['J’ai envie de te sucer']).map((v) => [v.code, v.severity])).toEqual([
      ['explicit_before_age', 'blocking'],
    ]);
    expect(checkExplicit(['Je suis toute', 'nue là']).map((v) => v.code)).toEqual(['explicit_before_age']);
  });

  it('lets a kiss, a ponytail, a cat or the rain through', () => {
    for (const bubble of [
      'Un gros baiser 😘',
      'J’ai fait une queue de cheval aujourd’hui',
      'Ma chatte Moka dort sur moi',
      'Je suis mouillée, il pleut des cordes',
      'Tu lis des bandes dessinées ?',
    ]) {
      expect(checkExplicit([bubble])).toEqual([]);
    }
  });
});

describe('guards read in context, not on a word alone (Charles 27/11, banc de la Sécurité)', () => {
  const raised = (bubble: string) => checkVoiceOutput([bubble], DEFAULT_GUARD_SETTINGS).map((v) => v.code);
  it.each([
    [
      'contact_info',
      ['je scrollais insta', 'j’ai pas snap désolé', 't’as vu ma story insta ?'],
      [
        'ajoute-moi sur snap',
        'viens sur telegram',
        'mon insta c’est lina.xx',
        'rejoins-moi sur discord',
        'je suis sur insta',
        'écris-moi @lina_xx',
      ],
    ],
    [
      'off_platform_payment',
      ['tu bosses dans la crypto ?', 'j’attends le virement de ma paie', 'pas de paypal ici'],
      [
        'envoie par paypal',
        'je te donne mon iban',
        'tu peux me payer en crypto',
        'un revolut ça marche aussi',
      ],
    ],
    [
      'love_declaration',
      ['je t’aime bien toi', 'j’aime bien ta façon de parler'],
      ['je t’aime', 'i love you'],
    ],
    [
      'meeting_promise',
      ['j’ai rdv chez le coiffeur demain', 'j’ai rendez-vous chez le dentiste'],
      ['rdv chez moi', 'on se fait un rdv', 'rendez-vous au café'],
    ],
    [
      'contempt',
      ['pauvre type celui qui t’a fait ça', 'petit menteur va 😏'],
      ['espèce de radin', 't’es qu’un minable', 'sale menteur'],
    ],
    [
      'ai_tic',
      ['je te retiens, pas tout de suite', 'je retiens mon souffle'],
      ['je note ton âge', 'je retiens ça'],
    ],
  ] as const)('%s', (code, passing, blocked) => {
    for (const bubble of passing) expect(raised(bubble), bubble).not.toContain(code);
    for (const bubble of blocked) expect(raised(bubble), bubble).toContain(code);
  });

  it('explicit_before_age lets a figure of speech through, and still reads the words', () => {
    for (const bubble of ['je m’en branle', 'tu sais me toucher avec tes mots', 'tu sais me toucher au cœur'])
      expect(checkExplicit([bubble]), bubble).toEqual([]);
    for (const bubble of ['j’ai envie de me toucher', 'je me touche en pensant à toi'])
      expect(
        checkExplicit([bubble]).map((v) => v.code),
        bubble,
      ).toContain('explicit_before_age');
  });
});

describe('price_outside_offer, a price of hers only (Charles 27/11)', () => {
  const price = (bubble: string, context: GuardContext = {}) =>
    checkVoiceOutput([bubble], DEFAULT_GUARD_SETTINGS, context).map((v) => v.code);

  it('lets a sum of everyday life, his sum said back and her offer’s own price through', () => {
    expect(price('t’as gagné 100 euros au poker ?')).not.toContain('price_outside_offer');
    expect(price('5 € mon café ce matin')).not.toContain('price_outside_offer');
    expect(price('50 € ? c’est beaucoup pour toi ça 😏', { fanAmountsMinor: [5_000] })).not.toContain(
      'price_outside_offer',
    );
    expect(price('pour toi c’est 15 euros', { allowedPriceMinor: 1_500 })).not.toContain(
      'price_outside_offer',
    );
  });

  it('blocks a price for what she sells that is not her offer’s, a sum agreed to, and any made-to-measure priced', () => {
    expect(price('pour toi c’est 15 euros')).toContain('price_outside_offer');
    expect(price('pour toi c’est 12 euros', { allowedPriceMinor: 1_500 })).toContain('price_outside_offer');
    expect(price('ok 10 euros', { allowedPriceMinor: 1_500, fanAmountsMinor: [1_000] })).toContain(
      'price_outside_offer',
    );
    expect(price('ta vidéo perso c’est 50 €', { allowedPriceMinor: 5_000 })).toContain('price_outside_offer');
    expect(price('je te fais une vidéo sur mesure pour 40 €')).toContain('price_outside_offer');
  });

  it('reads the sums he wrote', () => {
    expect(sumsMinorOf('je te donne 20 € ou 12,50 euros, pas 30 balles')).toEqual([2_000, 1_250, 3_000]);
  });
});

describe('a handle next to a network or a means, a price after he asked one (Sécurité, #1043)', () => {
  const raised = (bubble: string, context: GuardContext = {}) =>
    checkVoiceOutput([bubble], DEFAULT_GUARD_SETTINGS, context).map((v) => v.code);

  it('blocks a network with a plausible handle in the same bubble, and lets the name alone through', () => {
    for (const bubble of [
      'insta, lina.xx',
      'snap lina92 😘',
      'cherche lina rose sur tiktok',
      'tu me trouves sur insta',
    ])
      expect(raised(bubble), bubble).toContain('contact_info');
    for (const bubble of ['je poste sur insta vers 21h30', 't’as vu ma story insta ?', 'je scrollais insta'])
      expect(raised(bubble), bubble).not.toContain('contact_info');
  });

  it('blocks a means of paying with an identifier, and lets the word alone through', () => {
    expect(raised('paypal lina.xx@exemple.test')).toContain('off_platform_payment');
    expect(raised('lydia lina_rose')).toContain('off_platform_payment');
    expect(raised('pas de paypal ici')).not.toContain('off_platform_payment');
  });

  it('reads a sum alone, or a sum right after he asked a price, as a price of hers', () => {
    expect(raised('15 euros')).toContain('price_outside_offer');
    expect(raised('15€ 😘')).toContain('price_outside_offer');
    expect(raised('ah ben 30 €, pas mal', { fanAskedPrice: true })).toContain('price_outside_offer');
    expect(raised('15 euros', { allowedPriceMinor: 1_500 })).not.toContain('price_outside_offer');
    expect(raised('j’ai payé 30 € mes places hier')).not.toContain('price_outside_offer');
    expect(asksPrice('c’est combien ?')).toBe(true);
    expect(asksPrice('tu fais quoi ce soir ?')).toBe(false);
  });
});
