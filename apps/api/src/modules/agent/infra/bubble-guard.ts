import { checkVoiceOutput, type GuardCode, type GuardContext, type GuardSettings } from '../domain/guards';

/**
 * The hard guards on bubbles a chatter rewrote before approving (revue 09, G5): the same blocking reading as the
 * voice's output, bubble by bubble and as one unmasked message. Soft guards (length, count, tics) are the
 * chatter's call. Matched by shape by the `BubbleGuard` port of `conversations` (approval answers 422). With the
 * draft's context (P3-13: whether it carries a media, what she already sent him), the guards that need it are read
 * too; without, they are not.
 */
export interface AgentBubbleGuard {
  check(
    bubbles: readonly string[],
    context?: GuardContext,
  ): { readonly isBlocked: boolean; readonly codes: readonly GuardCode[] };
}

export function createBubbleGuard(settings: GuardSettings): AgentBubbleGuard {
  return {
    check(bubbles, context = {}) {
      const codes = checkVoiceOutput(bubbles, settings, context)
        .filter((v) => v.severity === 'blocking')
        .map((v) => v.code);
      return { isBlocked: codes.length > 0, codes: [...new Set(codes)] };
    },
  };
}
