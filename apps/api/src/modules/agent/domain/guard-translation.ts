import { isGuardedLanguage, normalise, type Language } from '@impera/contracts';

import { detectLanguage, type LanguageDecision } from './language';
import type { SafetySign } from './safety-net';
import { assessTrap, type TrapAssessment, type TrapInput } from './traps';

/**
 * Translation for the nets (ADR 0168 § 5 and § 7, amended 27/11, Charles: « l'IA a le maximum d'autonomie sans
 * validation humaine », relu par Sécurité). His message in a language the nets do not read is translated into French;
 * every input net reads his original and the French, and a net raised on either counts. Her draft then leaves
 * `humanOnly` only when the translation is valid, no net rose, and she answers in a covered language of hers. The
 * translation serves the nets alone: never his language (decided on his original, § 7), never sent, never kept.
 * Off by default (`CreatorSettings.translateForNets`); anything that fails keeps `humanOnly`.
 */

/** A French shorter than this share of his original (in characters) left something out: not valid. */
export const TRANSLATION_MIN_LENGTH_RATIO = 0.3;
/** His text past this many characters is not translated: `humanOnly` stays (a ceiling on the call's input). */
export const TRANSLATION_MAX_INPUT_CHARS = 2_000;
/** The call has this long, whatever the gateway's own timeouts: later, `humanOnly` stays. */
export const TRANSLATION_TIMEOUT_MS = 20_000;
/** One translation costs at most this, in dollars as `llm_calls` counts it; above, or unknown, `humanOnly` stays. */
export const TRANSLATION_MAX_COST_USD = 0.01;

/** Where the translation for the nets stands for one message of his. */
export type TranslationRead =
  /** Off, or his language is one the nets read: nothing was asked. */
  | { readonly kind: 'not_asked' }
  /** Asked and nothing usable came back (failed, too slow, too costly, too long to ask). */
  | { readonly kind: 'failed'; readonly reason: TranslationFailure }
  /**
   * A French text came back: the nets read it whatever `check` says (a doubt on his age raised on it keeps all its
   * effects); only a `valid` one may lift `humanOnly`.
   */
  | { readonly kind: 'translated'; readonly french: string; readonly check: TranslationCheck };

type TranslationFailure = 'failed' | 'timeout' | 'too_costly' | 'too_long';

/** What the adapter gives: his text in French, or why not. Never his language, never another target. */
export type FanTextTranslation =
  | { readonly ok: true; readonly french: string }
  | { readonly ok: false; readonly reason: TranslationFailure };

/**
 * The port (ADR 0168 § 5, amended 27/11): his ORIGINAL text into French, the only target. The adapter calls the
 * gateway's cheap role with his text in a typed data block, under its own time and cost ceilings.
 */
export interface FanTextTranslator {
  toFrench(
    text: string,
    trace: { readonly creatorId: string; readonly conversationId: string; readonly draftId: string },
  ): Promise<FanTextTranslation>;
}

/**
 * Whether his message goes to the translation: the setting on, and his language, as code reads it on his original
 * (this message's, else his kept one), outside the covered ones or undetermined. Nothing read and nothing kept: no.
 */
export function needsTranslation(input: {
  readonly on: boolean;
  readonly fanText: string;
  readonly kept: Language | null;
}): boolean {
  if (!input.on || input.fanText.trim() === '') return false;
  const fan = detectLanguage(input.fanText) ?? input.kept;
  return fan === 'unknown' || (fan !== null && !isGuardedLanguage(fan));
}

export type TranslationCheck =
  'valid' | 'empty' | 'unchanged' | 'too_short' | 'numbers_missing' | 'not_french';

/** The numbers written in digits in a text, each once (« 15 », « 2009 »): an age, a year, a class hide there. */
const numbersIn = (text: string): Set<string> =>
  new Set([...normalise(text).matchAll(/\d+/gu)].map(([digits]) => digits.replace(/^0+(?=\d)/u, '')));

/** Letters and digits only, the way two texts compare for « the same ». */
const bare = (text: string): string => normalise(text).replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Whether the French may lift `humanOnly` (Sécurité, 27/11): not empty, not his original given back, not much shorter
 * than it (`TRANSLATION_MIN_LENGTH_RATIO`), every number he wrote in digits found again in it (a translator steered
 * into writing something else drops his « 15 »), and not read plainly as another language than French.
 */
export function checkTranslation(original: string, french: string): TranslationCheck {
  const translated = french.trim();
  if (bare(translated) === '') return 'empty';
  if (bare(translated) === bare(original)) return 'unchanged';
  if (translated.length < TRANSLATION_MIN_LENGTH_RATIO * original.trim().length) return 'too_short';
  const kept = numbersIn(translated);
  if ([...numbersIn(original)].some((number) => !kept.has(number))) return 'numbers_missing';
  const read = detectLanguage(translated);
  if (read !== null && read !== 'french') return 'not_french';
  return 'valid';
}

/** The French the nets read beside his original; none when nothing came back. */
export const frenchOf = (read: TranslationRead): string | null =>
  read.kind === 'translated' ? read.french : null;

/** His text as the keyword nets read it: his original, then the French, so a word in either one sets them off. */
export function textForNets(original: string, read: TranslationRead): string {
  const french = frenchOf(read);
  return french === null ? original : `${original}\n${french}`;
}

/**
 * The rank of every sign, the gravest first. A `Record` over `SafetySign`: a sign added to the net (`minor_fantasy`,
 * #1043) does not compile until it has its rank here, so it can never be dropped in silence.
 */
const SIGN_RANK: Readonly<Record<SafetySign, number>> = { minor_suspected: 0, self_harm: 1 };

/** Every sign of both readings, each once, the gravest first; none is ever dropped. */
export function mergeSigns(original: readonly SafetySign[], translated: readonly SafetySign[]): SafetySign[] {
  return [...new Set([...original, ...translated])].sort((a, b) => SIGN_RANK[a] - SIGN_RANK[b]);
}

/**
 * The traps on his original, and on the French when there is one: a trap seen in the French counts as if he had
 * written it. The original's reading wins when both see one; the French is read alone, without his media.
 */
export function assessTrapRead(input: TrapInput, french: string | undefined): TrapAssessment {
  const original = assessTrap(input);
  if (original.isTrap || french === undefined || french.trim() === '') return original;
  const translated = assessTrap({ fanText: french, media: [], ...(input.brain && { brain: input.brain }) });
  return translated.isTrap ? translated : original;
}

/** What the turn raised, on his original or the French, as the lift reads it. */
export interface NetsRaised {
  readonly signs: readonly SafetySign[];
  /** Her alerts that went off (by a word, or read by the brain), pausing or only letting a human know. */
  readonly alerts: number;
  readonly trap: boolean;
  /** Risks the brain read in his message. */
  readonly risks: readonly string[];
  readonly care: boolean;
}

const raisedAny = (nets: NetsRaised): boolean =>
  nets.signs.length > 0 || nets.alerts > 0 || nets.trap || nets.risks.length > 0 || nets.care;

/**
 * `humanOnly` lifted (ADR 0168 § 5, amended 27/11) only when all hold: the translation came back valid, no net rose on
 * either reading, and her answer is in a language of hers the guards cover (the output guard `language_not_covered`
 * still reads what leaves). Anything else keeps the decision as it was.
 */
export function liftHumanOnly(
  decision: LanguageDecision,
  read: TranslationRead,
  nets: NetsRaised,
  spoken: readonly Language[],
): LanguageDecision {
  if (!decision.humanOnly) return decision;
  if (read.kind !== 'translated' || read.check !== 'valid') return decision;
  if (raisedAny(nets)) return decision;
  if (!isGuardedLanguage(decision.reply) || !spoken.includes(decision.reply)) return decision;
  return { ...decision, humanOnly: false };
}
