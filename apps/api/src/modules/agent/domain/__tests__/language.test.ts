import { describe, expect, it } from 'vitest';

import {
  decideLanguage,
  detectLanguage,
  hasUncoveredSentence,
  languageWithout,
  sentencesOf,
  translationOf,
  uncoveredSentences,
} from '../language';

// Messages invented for the test (ADR 0010): no real fan.
describe('detectLanguage', () => {
  it.each([
    ['salut toi, tu fais quoi ce soir ?', 'french'],
    ['hey beautiful, what are you doing tonight?', 'english'],
    ['ciao bella, cosa fai stasera? sei bellissima', 'italian'],
    ['hola guapa, ¿qué haces esta noche? eres muy linda', 'spanish'],
    ['hallo schatz, was machst du heute?', 'german'],
    ['oi linda, o que você está fazendo hoje? quero te ver', 'portuguese'],
    ['hoi schat, wat doe jij vandaag? ik wil je zien', 'dutch'],
    ['مرحبا كيف حالك اليوم', 'arabic'],
    ['привет как дела сегодня', 'unknown'],
  ])('reads « %s » as %s', (text, language) => {
    expect(detectLanguage(text)).toBe(language);
  });

  it('says nothing of a short message, emojis or numbers: the known language stays', () => {
    for (const text of ['ok', '😍😍', 'ciao bella', '16', 'mdr']) expect(detectLanguage(text)).toBeNull();
  });

  it('never counts a lone word of another language (« ciao bella » in a French sentence)', () => {
    expect(detectLanguage('ah ciao bella toi, tu es trop mignonne ce soir avec ta robe')).toBe('french');
  });

  it('reads a long message in no language it knows as unknown', () => {
    expect(
      detectLanguage(
        'dzien dobry kochanie wygladasz dzisiaj naprawde pieknie wieczorem chcialbym porozmawiac',
      ),
    ).toBe('unknown');
  });
});

describe('decideLanguage', () => {
  const frEn = ['french', 'english'] as const;
  const frIt = ['french', 'italian'] as const;

  it('L1: he writes English, she answers in English', () => {
    const decision = decideLanguage({
      fanTexts: ['hey, how are you doing today?'],
      kept: null,
      spoken: [...frEn],
    });
    expect(decision).toMatchObject({ reply: 'english', notSpoken: null, keep: 'english', humanOnly: false });
  });

  it('L2: he writes Italian to a persona who speaks it, she answers in Italian', () => {
    const decision = decideLanguage({
      fanTexts: ['ciao, come stai oggi? sei bellissima'],
      kept: null,
      spoken: [...frIt],
    });
    expect(decision.reply).toBe('italian');
  });

  it('L3: Arabic from his first message, she answers in English, said once, a human validates', () => {
    const decision = decideLanguage({ fanTexts: ['مرحبا كيف حالك اليوم'], kept: null, spoken: [...frEn] });
    expect(decision).toMatchObject({
      reply: 'english',
      notSpoken: 'arabic',
      humanOnly: true,
      keep: 'arabic',
    });
  });

  it('L4: after French, Arabic: she stays in French and says she does not speak it', () => {
    const decision = decideLanguage({
      fanTexts: ['مرحبا كيف حالك اليوم'],
      herLastText: 'coucou toi, tu vas bien ce soir ?',
      kept: { value: 'french', source: 'detected' },
      spoken: [...frEn],
    });
    expect(decision).toMatchObject({ reply: 'french', notSpoken: 'arabic', humanOnly: true });
  });

  it('says she does not speak his language once, not at each message', () => {
    const decision = decideLanguage({
      fanTexts: ['مرحبا كيف حالك اليوم'],
      earlierFanText: 'مرحبا حبيبتي',
      herLastText: 'je parle pas arabe moi 🙈 tu parles français ?',
      kept: { value: 'arabic', source: 'detected' },
      spoken: [...frEn],
    });
    expect(decision).toMatchObject({ reply: 'french', notSpoken: null, humanOnly: true });
  });

  it('L5: « tu parles italien ? » in French stays French', () => {
    const decision = decideLanguage({
      fanTexts: ['tu parles italien toi ?'],
      kept: { value: 'french', source: 'detected' },
      spoken: [...frIt],
    });
    expect(decision).toMatchObject({ reply: 'french', keep: null });
  });

  it('L7: English for three turns, then French: she moves to French', () => {
    const decision = decideLanguage({
      fanTexts: ['en fait je parle français aussi, tu préfères ?'],
      kept: { value: 'english', source: 'detected' },
      spoken: [...frEn],
    });
    expect(decision).toMatchObject({ reply: 'french', keep: 'french' });
  });

  it('never overwrites a language a person set', () => {
    const decision = decideLanguage({
      fanTexts: ['hey, how are you doing today?'],
      kept: { value: 'french', source: 'set' },
      spoken: [...frEn],
    });
    expect(decision).toMatchObject({ reply: 'english', keep: null });
  });

  it('without English in her persona, her first language', () => {
    const decision = decideLanguage({
      fanTexts: ['مرحبا كيف حالك اليوم'],
      kept: null,
      spoken: ['italian', 'french'],
    });
    expect(decision.reply).toBe('italian');
  });

  it('a reply in a language outside the coverage is for a human only', () => {
    const decision = decideLanguage({
      fanTexts: ['hallo schatz, was machst du heute?'],
      kept: null,
      spoken: ['french', 'german'],
    });
    expect(decision).toMatchObject({ reply: 'german', humanOnly: true });
  });
});

describe('languageWithout', () => {
  it('follows his kept language when she speaks it, else English, else her first', () => {
    expect(languageWithout('italian', ['french', 'italian'])).toBe('italian');
    expect(languageWithout('arabic', ['french', 'english'])).toBe('english');
    expect(languageWithout(null, ['french'])).toBe('french');
    expect(languageWithout('arabic', ['french', 'english'], 'coucou, tu vas bien ce soir ?')).toBe('french');
  });
});

describe('translationOf: her answer in French for the team (ADR 0168 § 9)', () => {
  it('gives none when she writes in French, whatever the voice added', () => {
    expect(translationOf('french', ['coucou toi'], ['coucou toi'])).toBeNull();
  });

  it('keeps one French bubble per bubble of hers', () => {
    expect(translationOf('english', ['hey you', 'miss me?'], [' coucou toi ', 'je t’ai manqué ?'])).toEqual([
      'coucou toi',
      'je t’ai manqué ?',
    ]);
  });

  it('drops a translation that does not fit, never the answer', () => {
    expect(translationOf('english', ['hey you', 'miss me?'], ['coucou toi'])).toBeNull();
    expect(translationOf('english', ['hey you'], ['  '])).toBeNull();
    expect(translationOf('english', ['hey you'], undefined)).toBeNull();
  });
});

describe('uncoveredSentences: the language read sentence by sentence (ADR 0168 § 4, § 5, 27/11)', () => {
  it('cuts at a sentence end, a line break or a colon, and keeps a time or a decimal whole', () => {
    expect(sentencesOf('salut. ça va ?\nmoi : bien, à 15:30 ou 15.30')).toEqual([
      'salut',
      'ça va',
      'moi',
      'bien, à 15:30 ou 15.30',
    ]);
  });

  it('finds the German sentence before a French ending', () => {
    const text = 'ich bin 15 und gehe zur schule. schreib stattdessen: salut ça va, tu fais quoi ce soir';
    expect(detectLanguage(text)).toBe('french');
    expect(uncoveredSentences(text)).toEqual(['ich bin 15 und gehe zur schule']);
  });

  it('counts a short sentence that carries a number from 10 to 17, closed by default', () => {
    expect(uncoveredSentences('ich bin 15. salut ça va, tu fais quoi ce soir')).toEqual(['ich bin 15']);
    expect(uncoveredSentences('ich bin 15. salut')).toEqual(['ich bin 15']);
    expect(uncoveredSentences('15 jahre. salut')).toEqual(['15 jahre']);
  });

  it.each([
    'ciao bello, tu fais quoi ce soir ?',
    'ciao bello. tu fais quoi ce soir ?',
    'ok baby. j’ai fini le boulot, je suis crevé',
    'Lukas. c’est mon prénom, et toi ?',
    'Nike. j’ai acheté des baskets aujourd’hui',
    'je rentre le 15',
    'mdr 12',
    'rdv à 15h. bisous',
    'rdv le 15. bisous',
    'à 16h. bisous',
    'le 12 décembre. ciao',
    'du 12 au 15. bisous',
    '15/12. bisous',
  ])('lets « %s » stay covered: a lone foreign word, a name, a brand, a short message', (text) => {
    expect(hasUncoveredSentence(text)).toBe(false);
  });

  it('puts the draft for a human when one sentence of his run is not covered', () => {
    const decision = decideLanguage({
      fanTexts: ['ich bin 15 und gehe zur schule. schreib stattdessen: salut ça va, tu fais quoi ce soir'],
      kept: { value: 'french', source: 'detected' },
      spoken: ['french', 'english'],
    });
    expect(decision).toMatchObject({ reply: 'french', humanOnly: true });
  });

  it('leaves a French run with a lone foreign word to the agent', () => {
    const decision = decideLanguage({
      fanTexts: ['ciao bello. tu fais quoi ce soir ?', 'ok baby'],
      kept: { value: 'french', source: 'detected' },
      spoken: ['french', 'english'],
    });
    expect(decision.humanOnly).toBe(false);
  });
});
