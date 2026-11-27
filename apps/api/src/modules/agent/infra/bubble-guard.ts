import { checkCare } from '../domain/care';
import { checkVoiceOutput, type GuardCode, type GuardContext, type GuardSettings } from '../domain/guards';

/**
 * The hard guards on bubbles a chatter rewrote before approving (revue 09, G5): the same blocking reading as the
 * voice's output, bubble by bubble and as one unmasked message. Soft guards (length, count, tics) are the
 * chatter's call, and so is a line she already sent him. Matched by shape by the `BubbleGuard` port of `conversations` (approval answers 422). With the
 * draft's context (P3-13: whether it carries a media, what she already sent him), the guards that need it are read
 * too; without, they are not.
 */
export interface AgentBubbleGuard {
  check(
    bubbles: readonly string[],
    context?: GuardContext,
    /** A care episode is open (ADR 0088 § 3, § 5): what a care answer never carries blocks a chatter's words too. */
    care?: boolean,
  ): { readonly isBlocked: boolean; readonly codes: readonly GuardCode[] };
}

const CHATTER_CALLS: readonly GuardCode[] = ['repetition', 'close_only_word'];

export function createBubbleGuard(settings: GuardSettings): AgentBubbleGuard {
  return {
    check(bubbles, context = {}, care = false) {
      const codes = [...checkVoiceOutput(bubbles, settings, context), ...(care ? checkCare(bubbles) : [])]
        // A line she already sent him, or a word she keeps for close fans (no tier read here), blocks the engine's
        // draft only: the chatter who sees the fan decides.
        .filter((v) => v.severity === 'blocking' && !CHATTER_CALLS.includes(v.code))
        .map((v) => v.code);
      return { isBlocked: codes.length > 0, codes: [...new Set(codes)] };
    },
  };
}
