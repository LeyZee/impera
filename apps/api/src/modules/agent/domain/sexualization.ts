import { normalise } from '@impera/contracts';

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
    context.desire < limits.minDesireToOpen
  )
    return { kind: 'no_opening' };
  return { kind: 'free' };
}

// An age under 18 in his message, unless it plainly is not his: a time (« marié depuis 6 ans », « ça fait 3 ans que »,
// « 16 ans d'expérience ») or his child's (« ma fille a 8 ans »). Read clause by clause. Any doubt left, it counts
// against him: « 25 ans… enfin 16 ans » is no adult's statement. The exemptions are a closed list (relecture Sécurité,
// #798): « dans 2 ans » is a minor's future, never a time past; « 17 ans d'ailleurs » is his age.
const UNDER_18 = '(?:1[0-7]|[1-9]|onze|douze|treize|quatorze|quinze|seize|dix(?:[ -]?sept)?)';
const UNDER_18_YEARS = new RegExp(
  `(?<!depuis |fait |il y a |pendant |en )\\b${UNDER_18} ?(?:ans|an|yo|years?|piges?)\\b` +
    `(?!\\s*(?:d'experience|de mariage|d'anciennete|de carriere|que je|que j'|que on|qu'on))`,
  'u',
);
// « J'en ai 15 », « jai 16 » without « ans »: his age all the same, unless a word follows (« j'ai 15 minutes »).
const UNDER_18_BARE = new RegExp(
  `\\bj(?:'| )?(?:en )?ai ${UNDER_18}(?!\\d|[ -]?(?:huit|neuf))(?=\\s*(?:$|[^\\p{L}\\s]|(?:et|mais|ok|lol|hein|perso|moi|toi)\\b))`,
  'u',
);
const SOMEONE_ELSES =
  /\b(?:fils|fille|filles|gamin|gamine|gamins|enfant|enfants|neveu|niece|gosse|gosses|bebe|frere|soeur|eleve|eleves)\b/u;
// A reserve beside an adult age: « 18 ans, enfin… », « en vrai », « bientôt », « dans 3 semaines ». No age is confirmed
// on a message that holds one: a refusal too many only costs a confirmation at his next message.
const ADULT_AGE_RESERVE =
  /\b(?:enfin|en vrai|bientot|presque|pas encore|(?:dans|d'ici) (?:\d+|un|une|deux|trois|quelques) (?:ans?|mois|semaines?|jours?))\b/u;

/** The clause gives someone else's age: a kin word before the age, never after (« 17 ans comme mon frère » is his). */
function someoneElsesAge(clause: string): boolean {
  const kin = SOMEONE_ELSES.exec(clause);
  const age = UNDER_18_YEARS.exec(clause);
  return kin !== null && age !== null && kin.index < age.index;
}

function minorAgeIn(text: string): boolean {
  if (safetySigns(text).includes('minor_suspected')) return true;
  if (UNDER_18_BARE.test(text)) return true;
  const adultAge =
    /(?<!\d)(?:1[89]|[2-9]\d)(?!\d)|dix[ -]?huit|dix[ -]?neuf|vingt|trente|quarante|cinquante|soixante/u;
  const reserved = adultAge.test(text) && ADULT_AGE_RESERVE.test(text);
  if (reserved) return true;
  return text.split(/[.,;!?\n…]+/u).some((clause) => UNDER_18_YEARS.test(clause) && !someoneElsesAge(clause));
}

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
  if (minorAgeIn(text)) return null;
  const inWords = agesInWords(text);
  for (const fact of facts) {
    if (fact.key !== 'age' || fact.kind !== 'declared' || fact.confidence < 0.8) continue;
    const value = normalise(fact.value);
    const numbers = value.match(/\d+/g) ?? [];
    const spelled = agesInWords(value);
    // One age, in digits or in words, never two: « entre 25 et 30 » is no statement.
    if (numbers.length + spelled.length !== 1) continue;
    const years = Number(numbers[0] ?? spelled[0]);
    if (years < 18 || years > 99) continue;
    const saidInDigits = new RegExp(`(^|\\D)${String(years)}(\\D|$)`).test(text);
    if (saidInDigits || inWords.includes(years)) return years;
  }
  return null;
}
