import { describe, expect, it } from 'vitest';

import {
  checkExplicit,
  checkVoiceOutput,
  DEFAULT_GUARD_SETTINGS,
  isBlocked,
  type GuardCode,
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

  it('keeps the ambiguity about meeting one day, without a promise nor a word the platforms flag', () => {
    expect(codes(['Si j’ai assez confiance en toi, un jour peut-être… qui sait', 'Pourquoi pas 🫣'])).toEqual(
      [],
    );
    // The same with « se rencontrer »: no promise, but a word Reveal flags (P3-13).
    expect(
      codes(['Si j’ai assez confiance en toi, un jour peut-être qu’on se rencontrera', 'Pourquoi pas 🫣']),
    ).toEqual(['platform_meeting_word']);
  });

  it('blocks contacts and links', () => {
    expect(codes(['Ajoute-moi sur snap'])).toEqual(['contact_info']);
    expect(codes(['Écris-moi à lina@example.com'])).toEqual(['contact_info']);
    expect(codes(['Mon 06 12 34 56 78'])).toEqual(['contact_info']);
    expect(codes(['Regarde https://example.com'])).toEqual(['contact_info']);
  });

  it('blocks the persona forbidden terms, accents and case ignored', () => {
    expect(codes(['Tu aimes le café ?'], ['cafe'])).toEqual(['forbidden_term']);
    expect(codes(['C’est banal, un canal'], ['anal'])).toEqual([]);
    expect(codes(['Pas d’anal, désolée'], ['anal'])).toEqual(['forbidden_term']);
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
    expect(codes(['Cette vidéo est à 6 €, tu l’ouvres en touchant le cadenas'])).toEqual([]);
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
      'Cette vidéo est à 6 €, tu l’ouvres en touchant le cadenas',
      'Je finis à 18 h au lieu de 20 h ce soir',
      'J’ai -10 % de batterie, je vais devoir te laisser',
      'Il fait -5 % de moral ce matin 😅',
    ]) {
      expect(codes([bubble])).toEqual([]);
    }
  });

  it('asks for a regeneration when she makes him feel guilty, without blocking', () => {
    const violations = checkVoiceOutput(['Bon… tu me déçois un peu là'], DEFAULT_GUARD_SETTINGS);
    expect(violations.map((v) => [v.code, v.severity])).toEqual([['guilt_trip', 'soft']]);
    expect(codes(['Tant pis, une prochaine fois 😌'])).toEqual([]);
    expect(codes(['Tu me déçois pas 😏'])).toEqual([]);
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
