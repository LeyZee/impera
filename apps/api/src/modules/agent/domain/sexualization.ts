import { normalise } from '@impera/contracts';

import type { GuardViolation } from './guards';
import { safetySigns } from './safety-net';

/**
 * When she may go sexual (P3-09, méthode de chatting): she opens it herself only after a delay set in the CRM, she
 * follows a fan who opens it only after a minimum of getting to know him, and never before his age is confirmed.
 * Pure code: the brain reads the moment, this decides (CLAUDE.md rule 3).
 */

export interface SexualizationLimits {
  /** Relationship time before she opens it herself (`strategies.sexualization.initiate_after_hours`). */
  readonly initiateAfterHours: number;
  /** Relationship time before she follows him there (`strategies.kyc.min_hours_before_following`). */
  readonly minHoursBeforeFollowing: number;
  /** His desire score before she opens it herself (`strategies.sexualization.min_desire_to_open`, P3-12). */
  readonly minDesireToOpen: number;
}

export interface SexualizationContext {
  readonly relationshipHours: number;
  readonly ageConfirmed: boolean;
  /** A human set « rien d'explicite » for him (`noExplicit`): suggestive at most, whatever his age. */
  readonly noExplicit: boolean;
  /** He is flirting or sexting now (`offerSignals`). */
  readonly fanSexualizes: boolean;
  /** His desire score after his message (`desireScore`): she opens it herself only once he is warm enough. */
  readonly desire: number;
  readonly limits: SexualizationLimits;
  /**
   * She already tried to open it herself this evening and he did not follow (passe 17, guide): one attempt per
   * evening, never a second. Absent, not known: as not tried.
   */
  readonly triedThisEvening?: boolean;
  /**
   * Inside the pause after his last purchase (ADR 0128 § 2): she does relation and does not open it herself; she still
   * follows him if he goes there. Absent, no pause.
   */
  readonly afterPurchase?: boolean;
}

export type SexualizationDecision =
  /** She may follow him, or open it herself. */
  | { readonly kind: 'free' }
  /** She may follow him, suggestive only: a human said nothing explicit for him. */
  | { readonly kind: 'suggestive_only' }
  /** He is not there and it is too early, he is not warm enough, or his age is unknown: she does not open it. */
  | { readonly kind: 'no_opening' }
  /** He goes there too early or without a confirmed age: she slows down, in her voice. */
  | { readonly kind: 'steer_back'; readonly reason: 'age_unconfirmed' | 'too_early' };

export function sexualizationDecision(context: SexualizationContext): SexualizationDecision {
  const { relationshipHours: hours, limits } = context;
  if (context.fanSexualizes) {
    if (!context.ageConfirmed) return { kind: 'steer_back', reason: 'age_unconfirmed' };
    if (hours < limits.minHoursBeforeFollowing) return { kind: 'steer_back', reason: 'too_early' };
    return context.noExplicit ? { kind: 'suggestive_only' } : { kind: 'free' };
  }
  if (
    !context.ageConfirmed ||
    context.noExplicit ||
    hours < limits.initiateAfterHours ||
    context.desire < limits.minDesireToOpen ||
    context.triedThisEvening === true ||
    context.afterPurchase === true
  )
    return { kind: 'no_opening' };
  return { kind: 'free' };
}

// When his words do not plainly give an adult age, no age is confirmed this turn (relecture Sécurité, #798): a
// closed rule, read on his whole message, rather than a list of what a minor writes. A refusal too many costs one
// message; he says it again or a human notes it.
const ADULT_NUMBER =
  '(?:(?<!\\d)(?:1[89]|[2-9]\\d)(?!\\d)|dix[ -]?huit|dix[ -]?neuf|vingt|trente|quarante|cinquante|soixante|quatre[ -]?vingt)';
// 1. A negation or a bound before an adult age: « je n'ai pas 18 ans », « moins de 18 », « même pas 20 ».
const NEGATED_ADULT = new RegExp(
  `\\b(?:pas|moins|sous|meme pas)\\b(?:\\s+[\\p{L}']+){0,2}\\s*${ADULT_NUMBER}`,
  'u',
);
// 2. A future, a due date or an approximation anywhere: « l'année prochaine », « en juin », « le 12 », « demain »,
// « dans… », « quasi », « enfin », « en vrai ».
const UNSURE =
  /\b(?:aurai|aurais|vais avoir|vas avoir|va avoir|prochain|prochaine|demain|bientot|presque|quasi|quasiment|environ|a peu pres|pratiquement|pas encore|enfin|en vrai|dans|d'ici|en (?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)|le (?:\d{1,2}|1er|premier)\b)/u;
// 3. Any other number under 18, in digits or in words, unless it plainly counts something else: a duration or a
// quantity of a closed list, a time past (« depuis 6 ans »), or someone else's (a kin word before it).
const SMALL_NUMBER =
  /(?<![\d,.])(?<!(?:vingt|trente|quarante|cinquante|soixante|dix)[ -](?:et )?)\b(?:1[0-7]|[0-9]|onze|douze|treize|quatorze|quinze|seize|dix(?:[ -]?sept)?|deux|trois|quatre|cinq|six|sept|huit|neuf)\b(?![,.]?\d|[ -]?(?:huit|neuf|vingts?)\b)/gu;
const COUNTED =
  /^\s*(?:ans? (?:d'experience|de mariage|d'anciennete|de carriere|que je|que j'|que on|qu'on)|mois|minutes?|min|heures?|h\b|secondes?|sec|fois|cm|m\b|km|kg|g\b|euros?|€|%|jours?|semaines?|nuits?|enfants?|gosses?|chats?|chiens?|freres?|soeurs?|personnes?|potes?|amis?|messages?|photos?|videos?)/u;
const TIME_PAST = /(?:depuis|fait|il y a|pendant|en)\s*$/u;
const SOMEONE_ELSES =
  /\b(?:fils|fille|filles|gamin|gamine|gamins|enfant|enfants|neveu|niece|gosse|gosses|bebe|frere|soeur|eleve|eleves)\b/u;

// A kin word right before the number, at most two words between (« ma fille a 8 ans », « mon fils de 6 ans »): that
// number is someone else's, and the ones joined to it (« de 8 et 10 ans »), never another one of the clause.
const KIN_BEFORE = new RegExp(`${SOMEONE_ELSES.source}(?:\\s+[\\p{L}']+){0,2}\\s*$`, 'u');
const JOINED = /^\s*(?:ans?\s*)?(?:et|ou|,)?\s*$/u;

function strayUnder18(text: string): boolean {
  return text.split(/[.;!?\n…]+/u).some((sentence) =>
    sentence.split(/,/u).some((clause) => {
      let exemptEnd: number | null = null;
      for (const match of clause.matchAll(SMALL_NUMBER)) {
        const before = clause.slice(0, match.index);
        const after = clause.slice(match.index + match[0].length);
        const kin: boolean =
          KIN_BEFORE.test(before) ||
          (exemptEnd !== null && JOINED.test(clause.slice(exemptEnd, match.index)));
        exemptEnd = kin ? match.index + match[0].length : null;
        if (kin || COUNTED.test(after)) continue;
        if (/^\s*(?:ans?|piges?)\b/u.test(after) && TIME_PAST.test(before)) continue;
        return true;
      }
      return false;
    }),
  );
}

// A school year written short (« 4eme », « 3e », « 2nde »): a minor's sign the safety net does not read glued.
const SCHOOL_YEAR = /\b(?:[3-6](?:e|eme)|2nde)\b/u;

/** His message leaves his adult age in doubt: a minor's sign, a negation, a future, an approximation, a stray age. */
function ageUnsure(text: string): boolean {
  if (safetySigns(text).includes('minor_suspected')) return true;
  return NEGATED_ADULT.test(text) || UNSURE.test(text) || SCHOOL_YEAR.test(text) || strayUnder18(text);
}

// 4. Only a plain positive clause of his confirms, whatever the age (relecture Sécurité, #798): « j'ai 25 ans »,
// « moi c'est 19 », « 20 ans et toi ? », « je viens d'avoir 18 ans », « j'ai 40 ans et ma fille a 8 ans ». Not « tu as
// 25 ans ? », « je fais 25 ans », « ma copine a 25 ans », « j'ai 25 ans ou pas ».
const SPELLED_ADULT =
  '(?:dix[ -]?huit|dix[ -]?neuf|(?:vingt|trente|quarante|cinquante|soixante|quatre[ -]vingts?)(?:[ -](?:et[ -])?(?:un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix[ -](?:sept|huit|neuf)))?)';
const PLAIN_AGE = new RegExp(
  `^\\s*(?:(?:et |bah |ben |ok |oui |moi )?(?:moi c'est|moi|j'ai|jai|j ai|je viens d'avoir|j'ai eu|perso|j'en ai)\\s+)?` +
    `(?:\\d{2}|${SPELLED_ADULT})\\s*(?:ans?)?(?:\\s+(?:et toi|toi|et vous|t'as quel age|et\\b.*))?` +
    `(?:\\s|\\p{Extended_Pictographic}|\\u{200d}|\\u{fe0f})*$`,
  'u',
);

/** A plain positive clause of his gives `years`, in digits or in words. */
const plainAge = (text: string, years: number): boolean =>
  text
    .split(/[.,;!?\n…]+/u)
    .some(
      (clause) =>
        PLAIN_AGE.test(clause) &&
        (new RegExp(`(^|\\D)${String(years)}(\\D|$)`).test(clause) || agesInWords(clause).includes(years)),
    );

const UNITS = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
const TEENS = [
  'dix',
  'onze',
  'douze',
  'treize',
  'quatorze',
  'quinze',
  'seize',
  'dix-sept',
  'dix-huit',
  'dix-neuf',
];
const TENS: Readonly<Record<number, string>> = {
  2: 'vingt',
  3: 'trente',
  4: 'quarante',
  5: 'cinquante',
  6: 'soixante',
  8: 'quatre-vingt',
};

/** An age from 18 to 99 in French words, as he may write it: « vingt-cinq », « trente et un », « quatre-vingts ». */
function frenchAge(years: number): string {
  if (years < 20) return TEENS[years - 10] ?? '';
  const ten = Math.floor(years / 10);
  const unit = years % 10;
  if (ten === 7 || ten === 9) {
    const base = ten === 7 ? 'soixante' : 'quatre-vingt';
    const teen = TEENS[unit] ?? '';
    return ten === 7 && unit === 1 ? `${base} et ${teen}` : `${base}-${teen}`;
  }
  const tens = TENS[ten] ?? '';
  if (unit === 0) return ten === 8 ? 'quatre-vingts' : tens;
  if (unit === 1 && ten !== 8) return `${tens} et un`;
  return `${tens}-${UNITS[unit] ?? ''}`;
}

/** Every adult age in words, the longest first: « vingt et un » is read before « vingt ». */
const SPELLED_AGES = Array.from({ length: 82 }, (_, index) => {
  const years = index + 18;
  return { years, words: frenchAge(years).replace(/-/g, ' ') };
}).sort((a, b) => b.words.length - a.words.length);

/** The adult ages written in words in his message, read with or without hyphens, each word read once. */
function agesInWords(text: string): number[] {
  let rest = text.replace(/-/g, ' ');
  const found: number[] = [];
  for (const { years, words } of SPELLED_AGES) {
    const pattern = new RegExp(`(^|[^a-z])${words}(?=[^a-z]|$)`, 'gu');
    if (!pattern.test(rest)) continue;
    found.push(years);
    rest = rest.replace(pattern, '$1 ');
  }
  return found;
}

/**
 * The adult age he states himself, which confirms it (Charles, 27/10 18h38): an age fact the brain read as declared
 * and sure, one number from 18 to 99, that he wrote in his own message, with no minor's age beside it. The brain's
 * reading alone never confirms: the number must be in his words.
 */
export function declaredAdultAge(
  facts: readonly {
    readonly key: string;
    readonly value: string;
    readonly kind: string;
    readonly confidence: number;
  }[],
  fanText: string,
): number | null {
  const text = normalise(fanText);
  if (ageUnsure(text)) return null;
  for (const fact of facts) {
    if (fact.key !== 'age' || fact.kind !== 'declared' || fact.confidence < 0.8) continue;
    const value = normalise(fact.value);
    const numbers = value.match(/\d+/g) ?? [];
    const spelled = agesInWords(value);
    // One age, in digits or in words, never two: « entre 25 et 30 » is no statement.
    if (numbers.length + spelled.length !== 1) continue;
    const years = Number(numbers[0] ?? spelled[0]);
    if (years < 18 || years > 99) continue;
    if (plainAge(text, years)) return years;
  }
  return null;
}

// A brake in her words: « tu y vas un peu fort », « doucement », « tu t'emballes », « on se calme », « pas si vite »;
// or a word on how he came at her: « tu vises direct », « t'es direct toi », « tu perds pas de temps », « tu commences
// fort », « t'es pressé », « dès le premier message » (Charles, 20/11).
const BRAKE = new RegExp(
  [
    String.raw`\b(?:tu y vas|t'?y vas|tu vas|tu fonces)\b.{0,15}\b(?:fort|vite)\b`,
    String.raw`\b(?:trop|pas si|un peu|bien) vite\b`,
    String.raw`\bdoucement\b`,
    String.raw`\btu t'?emballes?\b`,
    String.raw`\bon se calme\b`,
    String.raw`\bcalme[- ]toi\b`,
    String.raw`\btu vises\b`,
    String.raw`\b(?:t'?es|tu es|toi t'?es|t'?etais)\s+(?:(?:bien|tres|trop|vachement|super|plutot)\s+)?(?:direct|cash|presse|rapide|entreprenant|culotte|audacieux|gonfle)\b`,
    String.raw`\b(?:direct|cash)\s+(?:toi|dis donc|hein|comme ca|des le)\b`,
    String.raw`\btu (?:commences|attaques|demarres|entres|arrives)\s+(?:fort|direct|cash)\b`,
    String.raw`\btu (?:ne )?perds pas de temps\b`,
    String.raw`\bdes le premier message\b`,
    String.raw`\bon se connait (?:a peine|meme pas|pas)\b`,
  ].join('|'),
  'u',
);

/**
 * She never slows down a fan who does not go there (Charles, 20/11): a compliment, even an insistent one, is welcomed,
 * with a thank-you and a tease. Read when the cursor did not steer him back; blocking, so the voice writes it again.
 */
export function checkWelcome(bubbles: readonly string[]): GuardViolation[] {
  const violations: GuardViolation[] = [];
  bubbles.forEach((bubble, bubbleIndex) => {
    const match = BRAKE.exec(normalise(bubble))?.[0];
    if (match !== undefined)
      violations.push({ code: 'unwarranted_brake', severity: 'blocking', bubbleIndex, match });
  });
  return violations;
}
