import { isGuardedLanguage, LANGUAGES, normalise, type Language } from '@impera/contracts';

import { BARE_TEEN_NOT_A_DATE } from './teen-number';

/**
 * The fan's language, decided by code (ADR 0168): read on what he wrote, never guessed by a model, then given to the
 * voice as a fixed instruction. Pure: the caller reads his kept language and her persona's languages.
 */

/**
 * What code reads of one message: a language of `LANGUAGES`, `'unknown'` (words in a language or a script it does not
 * read), or `null` when the message says nothing (too short, emojis, numbers, one word, no language ahead): the
 * language already known stays.
 */
export type DetectedLanguage = Language | 'unknown' | null;

/** Fewer words than this, the message says nothing of his language (« ok », « ciao bella », « 😍 »). */
const MIN_WORDS = 3;
/** The leading language needs at least this weight of its words, and more than any other. */
const MIN_HITS = 2;
/**
 * The leading language needs this share of his words (ADR 0168 § 1): two common words of a covered language lost in a
 * long sentence of another never make it that language.
 */
const MIN_SHARE = 0.2;
/** From this many words, a message no language reads plainly is in one code does not read (`'unknown'`). */
const UNKNOWN_FROM_WORDS = 5;
/** Her own text, read by the output guard: from this many words, a text no language reads plainly does not pass. */
export const OUTPUT_UNKNOWN_FROM_WORDS = 8;

// Short, common words of each language. A word in several lists is shared between them.
const WORDS: Readonly<Record<Exclude<Language, 'arabic'>, readonly string[]>> = {
  french: (
    'je tu il elle nous vous les des du est et pas mais avec pour sur dans ce cette mon ton ma ta ' +
    'mes tes moi toi oui bien trop tres quoi comment aussi encore fait suis es ai as avoir etre veux ' +
    'peux jamais toujours bonjour salut coucou merci bisous ca cest jai jsuis chui ouais mdr ptdr ' +
    'beaucoup aujourd demain soir quand parce qu au aux un une que de la le en il me te se qui on y ' +
    'faut plus rien tout vais va vas sais dis dit ici sont ont avez etes peut veut chez apres avant ' +
    'deja vraiment envie ou lui leur sa son ses nos vos ces cet pourquoi alors donc tellement ' +
    'deux trois quatre cinq six sept huit neuf dix compte reste faut si a'
  ).split(' '),
  english: (
    'i you he she we they the and is are was not but with for this that my your me yes yeah what how ' +
    'why too very have has do does did can will would want like love hi hello hey thanks thank im ' +
    'its dont cant just so really babe baby beautiful today tonight when because of to in it be am ' +
    'at on an or all from about know think'
  ).split(' '),
  italian: (
    'io sei sono il lo gli della delle del che non ma con per questo questa mio mia tuo tua mi ti si ' +
    'anche ancora molto troppo cosa come perche quando oggi domani stasera ciao grazie bella bello ' +
    'amore tesoro voglio vuoi posso puoi hai ho ha abbiamo essere avere fare fatto sempre mai tutto ' +
    'tutti niente nulla adesso ora dove chi bene piu gia sto stai sta qui cosi davvero proprio ' +
    'allora baci un una uno di nel nella al alla'
  ).split(' '),
  spanish: (
    'yo eres soy el los las del que no pero con por para este esta esto mi tu te me si tambien ' +
    'todavia mucho muy como porque cuando hoy manana noche hola gracias guapa hermosa linda amor ' +
    'carino quiero quieres puedo puedes tienes tengo tiene hay estoy estas ser hacer hecho ' +
    'siempre nunca todo todos nada ahora donde quien bien mas ya aqui asi verdad entonces besos un ' +
    'una uno pues vale jaja'
  ).split(' '),
  german: (
    'ich du er sie wir ihr der die das und ist nicht aber mit fur dich mich mein dein ja nein was ' +
    'wie warum sehr auch noch haben hast habe bin bist kann willst will hallo danke schon heute ' +
    'morgen wenn weil ein eine einen nur jetzt hier gut liebe schatz geil jahre jahr'
  ).split(' '),
  portuguese: (
    'eu voce vc ele ela nos os as do da dos das que nao mas com para pra isso isto meu minha teu tua ' +
    'sim tambem ainda muito como porque quando hoje amanha noite ola oi obrigado obrigada linda ' +
    'gostosa quero queres posso pode tenho tem estou esta ser fazer sempre nunca tudo nada agora ' +
    'onde bem mais ja aqui assim beijos um uma kkk kkkk'
  ).split(' '),
  dutch: (
    'ik jij je hij zij wij het een en is niet maar met voor dit dat mijn jouw mij ja nee wat hoe ' +
    'waarom heel ook nog hebben heb hebt ben bent kan wil hallo hoi dank bedankt mooi vandaag morgen ' +
    'als omdat nu hier goed lief schat lekker zo van op te naar'
  ).split(' '),
};

/**
 * Common words of Latin-script languages outside `LANGUAGES`: read only so that a message in one of them leads to
 * `'unknown'`, never to the covered language a few of its short words also belong to (ADR 0168 § 1).
 */
const OTHER_WORDS: Readonly<Record<string, readonly string[]>> = {
  polish: (
    'jest nie sie ze mam masz jestem jestes bardzo dzien dobry czesc dzieki tego tej cie moj moja twoj ' +
    'twoja lubie chce lat wiem moze juz tylko teraz gdzie kiedy dlaczego jak'
  ).split(' '),
  romanian: (
    'faci sunt esti eu si nu cu pe mai foarte asta acum vreau vrei vad seara buna frumoasa frumoaso ' +
    'iubire multumesc ani este care cand unde'
  ).split(' '),
  swedish: (
    'jag hon vi det och att inte ar ett vill pa som vad hur hej tack mycket bra ikvall idag imorgon ' +
    'alskar gillar vacker snygg ocksa'
  ).split(' '),
  czech: 'jsem jsi ano proc kdy kde dekuji moc rad chci'.split(' '),
  turkish: (
    'ben sen biz siz bir ve bu nasil neden evet hayir cok guzel seni seviyorum merhaba tesekkur ' +
    'yasindayim istiyorum var yok'
  ).split(' '),
};

const LISTED = [...Object.entries(WORDS), ...Object.entries(OTHER_WORDS)].flatMap(([language, words]) =>
  words.map((word) => ({ language, word })),
);
/** For each word, the languages that write it, covered or not. */
const LANGUAGES_OF = new Map<string, string[]>();
for (const { language, word } of LISTED) {
  const languages = LANGUAGES_OF.get(word) ?? [];
  if (!languages.includes(language)) LANGUAGES_OF.set(word, [...languages, language]);
}

/** A language of `LANGUAGES`, or `'unknown'` for one of the others code knows a few words of. */
const asDetected = (language: string): Language | 'unknown' =>
  LANGUAGES.find((known) => known === language) ?? 'unknown';

const LATIN = /\p{Script=Latin}/u;

/** How many characters of the text the pattern (global) matches. */
const countOf = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
const letterCount = (text: string): number => countOf(text, /\p{L}/gu);
const latinCount = (text: string): number => countOf(text, /\p{Script=Latin}/gu);

/** Whether most letters of the text are Latin ones: a text code reads by its words, not by its script. */
export function isMostlyLatin(text: string): boolean {
  return latinCount(text) * 2 >= letterCount(text);
}

/** His words, lower case, accents off, apostrophes joined (« j'ai » reads « jai »), raw script kept. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/['’`]/gu, '')
    .split(/[^\p{L}]+/u)
    .filter((word) => word !== '');
}

/**
 * The language of one message of his (ADR 0168 § 1): the leading one, by its own words; a lone word of another
 * language in it never counts (« ciao bella » in a French sentence). Letters mostly of another script than Latin read
 * as Arabic, or as `'unknown'`.
 */
export function detectLanguage(text: string): DetectedLanguage {
  const letters = letterCount(text);
  if (letters === 0) return null;
  if (!isMostlyLatin(text)) return countOf(text, /\p{Script=Arabic}/gu) * 2 >= letters ? 'arabic' : 'unknown';
  const words = wordsOf(text).filter((word) => LATIN.test(word));
  if (words.length < MIN_WORDS) return null;
  // A word several languages write counts for each, shared: « que » is a third of French, Spanish and Portuguese.
  const hits = new Map<string, number>();
  for (const word of words) {
    const languages = LANGUAGES_OF.get(word) ?? [];
    for (const language of languages) hits.set(language, (hits.get(language) ?? 0) + 1 / languages.length);
  }
  const ranked = [...hits.entries()].toSorted((a, b) => b[1] - a[1]);
  const [first, second] = ranked;
  // A reading is plain or it is none: a weak one is never his language (ADR 0168 § 1, closed by default).
  const plain =
    first !== undefined &&
    first[1] >= MIN_HITS &&
    first[1] >= words.length * MIN_SHARE &&
    (second === undefined || second[1] < first[1]);
  if (plain) return asDetected(first[0]);
  return words.length >= UNKNOWN_FROM_WORDS ? 'unknown' : null;
}

/**
 * The sentences of a message: cut at a full stop, a question or exclamation mark, a semicolon or an ellipsis followed
 * by a space or the end, at a line break, or at a colon followed by a space. « 15.30 » or « 15:30 » stay whole.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/[.!?;…]+(?=\s|$)|\n+|:\s/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

/** Whether a word of the sentence belongs to a language the guards read (« rdv le 15 », « à 16h »). */
function hasCoveredWord(sentence: string): boolean {
  return wordsOf(sentence).some((word) =>
    (LANGUAGES_OF.get(word) ?? []).some((language) => {
      const read = asDetected(language);
      return read !== 'unknown' && isGuardedLanguage(read);
    }),
  );
}

/** Whether a word of the sentence is written only by languages the guards do not read (« ich », « jahre », « mam »). */
function hasForeignWord(sentence: string): boolean {
  return wordsOf(sentence).some((word) => {
    const languages = LANGUAGES_OF.get(word) ?? [];
    return (
      languages.length > 0 &&
      languages.every((language) => {
        const read = asDetected(language);
        return read === 'unknown' || !isGuardedLanguage(read);
      })
    );
  });
}

/** A sentence that is only the number (« 15 », « 17 ! »). */
const ONLY_THE_NUMBER =
  /^[\s\p{P}\p{Extended_Pictographic}\uFE0F]*1[0-7][\s\p{P}\p{Extended_Pictographic}\uFE0F]*$/u;

/**
 * What a number from 10 to 17 that no age word explains says (ADR 0168 § 4, two levels, 27/11). `'age'`, the age
 * doubt: the number is alone in its sentence (« salut. 15 »), it answers her question about his age, or its sentence
 * carries a word only a language outside the coverage writes, or another script (« ich bin 15. salut », « 15 jahre.
 * salut »). `'human'`: the number stands among words no lexicon knows (« saison 12. tu regardes ? »), a human reads it,
 * without the doubt. `null`: a date, an hour, a sum, a measure or a rank, or a sentence with a word of a covered
 * language (« rdv le 15 », « j'habite au 14 »).
 */
export type BareTeenReading = 'age' | 'human' | null;

export function bareTeenReading(text: string, askedAge = false): BareTeenReading {
  let reading: BareTeenReading = null;
  for (const sentence of sentencesOf(text)) {
    if (!BARE_TEEN_NOT_A_DATE.test(normalise(sentence))) continue;
    if (ONLY_THE_NUMBER.test(sentence) || askedAge || !isMostlyLatin(sentence) || hasForeignWord(sentence))
      return 'age';
    if (!hasCoveredWord(sentence)) reading = 'human';
  }
  return reading;
}

/**
 * The sentences of his message that the guards do not read (ADR 0168 § 4 and § 5, read sentence by sentence on 27/11):
 * a sentence read plainly as `'unknown'`, as a language outside `GUARDED_LANGUAGES`, or in another script. A sentence
 * too short to be read plainly (« ciao bello », « ok baby », a first name, a brand) is not one of them, unless it
 * carries a number from 10 to 17 that is no date, hour, sum, measure or rank, with no word of a covered language
 * (« ich bin 15. salut », « saison 12. tu regardes ? »; not « rdv le 15. bisous »): closed by default. The single
 * source for `humanOnly`; the translation reads it too. Whether the number is also an age doubt is `bareTeenReading`.
 */
export function uncoveredSentences(text: string): string[] {
  return sentencesOf(text).filter((sentence) => {
    const read = detectLanguage(sentence);
    if (read === null) return !hasCoveredWord(sentence) && BARE_TEEN_NOT_A_DATE.test(normalise(sentence));
    return read === 'unknown' || !isGuardedLanguage(read);
  });
}

/** Whether one sentence of his message is enough to treat it as one the guards do not read (ADR 0168 § 5). */
export function hasUncoveredSentence(text: string): boolean {
  return uncoveredSentences(text).length > 0;
}

/** How many words of the text code reads as words (Latin letters): what the output guard measures. */
export function latinWordCount(text: string): number {
  return wordsOf(text).filter((word) => LATIN.test(word)).length;
}

/** What code decided for her answer (ADR 0168 § 2). */
export interface LanguageDecision {
  /** The language she writes in: one of her persona's, always. */
  readonly reply: Language;
  /** His language as code reads it now: this message's, or his kept one; `null` when nothing was ever read. */
  readonly fan: Language | 'unknown' | null;
  /**
   * His language she does not speak, said once by her in her own way (« je parle pas arabe 🙈 »); `null` when she
   * speaks it, or already said so.
   */
  readonly notSpoken: Language | 'unknown' | null;
  /** His new kept language to store, when this message changed it; `null`: unchanged. */
  readonly keep: Language | null;
  /**
   * His language or hers is outside the guards' coverage (`GUARDED_LANGUAGES`) or undetermined: nothing leaves without
   * a human (ADR 0168 § 4), whatever her mode.
   */
  readonly humanOnly: boolean;
}

export interface LanguageDecisionInput {
  /** His last messages, the latest last (the run she answers). */
  readonly fanTexts: readonly string[];
  /** His message before this run, to know whether she already said she does not speak his language. */
  readonly earlierFanText?: string;
  /**
   * His messages before this run, oldest first: read together with this one when it says nothing alone and no
   * language is kept (ADR 0168 § 1).
   */
  readonly earlierFanTexts?: readonly string[];
  /** Her last message to him, to keep the language they already speak. */
  readonly herLastText?: string;
  /** His kept language, `null` before any; `set` by a person, code never overwrites it. */
  readonly kept: { readonly value: Language; readonly source: 'detected' | 'set' } | null;
  /** Her persona's languages, in her order (`spoken_languages`): at least one. */
  readonly spoken: readonly [Language, ...Language[]];
}

/** The first language read in these texts, the latest first; `null` when none says anything. */
function latestDetected(texts: readonly string[]): DetectedLanguage {
  for (const text of texts.toReversed()) {
    const detected = detectLanguage(text);
    if (detected !== null) return detected;
  }
  return detectLanguage(texts.join(' '));
}

/**
 * The language of her answer (ADR 0168 § 2): his, when she speaks it; else the one they already speak, and she tells
 * him once she does not speak his; else English when her persona has it, else her first language.
 */
/** His last messages read together: the few before this run pooled with it. */
const POOLED_MESSAGES = 5;

export function decideLanguage(input: LanguageDecisionInput): LanguageDecision {
  const alone = latestDetected(input.fanTexts);
  const detected =
    alone === null && input.kept === null && input.earlierFanTexts !== undefined
      ? detectLanguage([...input.earlierFanTexts.slice(-POOLED_MESSAGES), ...input.fanTexts].join('\n'))
      : alone;
  const fan: Language | 'unknown' | null = detected ?? input.kept?.value ?? null;
  const speaks = (language: Language | 'unknown' | null): language is Language =>
    language !== null && language !== 'unknown' && input.spoken.includes(language);
  const keep =
    detected !== null &&
    detected !== 'unknown' &&
    input.kept?.source !== 'set' &&
    detected !== input.kept?.value
      ? detected
      : null;
  const hers = input.herLastText === undefined ? null : detectLanguage(input.herLastText);
  const reply: Language = speaks(fan)
    ? fan
    : speaks(hers)
      ? hers
      : input.spoken.includes('english')
        ? 'english'
        : input.spoken[0];
  const earlier = input.earlierFanText === undefined ? null : detectLanguage(input.earlierFanText);
  const notSpoken = fan === null || speaks(fan) || earlier === fan ? null : fan;
  const humanOnly =
    fan === 'unknown' ||
    (fan !== null && !isGuardedLanguage(fan)) ||
    !isGuardedLanguage(reply) ||
    input.fanTexts.some(hasUncoveredSentence);
  return { reply, fan, notSpoken, keep, humanOnly };
}

/**
 * The language of a message without his words (a follow-up, a welcome, her word after a sale): his kept one when she
 * speaks it, else English when her persona has it, else her first (ADR 0168 § 3).
 */
export function languageWithout(
  kept: Language | null,
  spoken: readonly [Language, ...Language[]],
  herLastText?: string,
): Language {
  if (kept !== null && spoken.includes(kept)) return kept;
  const hers = herLastText === undefined ? null : detectLanguage(herLastText);
  if (hers !== null && hers !== 'unknown' && spoken.includes(hers)) return hers;
  return spoken.includes('english') ? 'english' : spoken[0];
}

/**
 * The decision for a message of hers without his words (a follow-up, her word after a sale, a welcome): the language
 * of `languageWithout`, nothing to say about his, and for a human only when his kept language or hers is outside the
 * guards' coverage (ADR 0168 § 3, § 4).
 */
export function quietLanguage(
  kept: Language | null,
  spoken: readonly [Language, ...Language[]],
  herLastText?: string,
): LanguageDecision {
  const reply = languageWithout(kept, spoken, herLastText);
  return {
    reply,
    fan: kept,
    notSpoken: null,
    keep: null,
    humanOnly: (kept !== null && !isGuardedLanguage(kept)) || !isGuardedLanguage(reply),
  };
}

/**
 * Her answer in French for the team (ADR 0168 § 9), from the voice's own call: only when she writes in another
 * language, and only one French bubble per bubble of hers, none empty. Anything else is no translation (`null`):
 * the answer never depends on it, and it is never sent.
 */
export function translationOf(
  reply: Language,
  bubbles: readonly string[],
  translation: readonly string[] | undefined,
): readonly string[] | null {
  if (reply === 'french' || translation === undefined) return null;
  if (translation.length !== bubbles.length || bubbles.length === 0) return null;
  const cleaned = translation.map((bubble) => bubble.trim());
  return cleaned.some((bubble) => bubble === '') ? null : cleaned;
}
