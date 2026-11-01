import { normalise } from '@nirvana/contracts';

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

// An age under 18 said anywhere in his message: « 25 ans… enfin 16 ans » is no adult's statement.
const MINOR_AGE = /\b(1[0-7]|[1-9]) ?(ans|an|yo|years?)\b/;

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
  if (MINOR_AGE.test(text)) return null;
  for (const fact of facts) {
    if (fact.key !== 'age' || fact.kind !== 'declared' || fact.confidence < 0.8) continue;
    const numbers = fact.value.match(/\d+/g) ?? [];
    const [age] = numbers;
    if (numbers.length !== 1 || age === undefined) continue;
    const years = Number(age);
    if (years >= 18 && years <= 99 && new RegExp(`(^|\\D)${age}(\\D|$)`).test(text)) return years;
  }
  return null;
}
