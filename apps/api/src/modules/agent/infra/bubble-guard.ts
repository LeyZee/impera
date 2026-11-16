import { withAccountGuard, type ShareableAccount } from '../domain/accounts';
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
    /**
     * Her user names, and the account that may leave in these bubbles (ADR 0143 bounds 19, 21): any other name of hers
     * blocks. Absent, her names are not read and nothing of a contact passes.
     */
    accounts?: { readonly usernames: readonly string[]; readonly allowed: ShareableAccount | null },
  ): { readonly isBlocked: boolean; readonly codes: readonly GuardCode[] };
}

export function createBubbleGuard(settings: GuardSettings): AgentBubbleGuard {
  return {
    check(bubbles, context = {}, care = false, accounts) {
      const read = withAccountGuard(
        checkVoiceOutput(bubbles, settings, context),
        bubbles,
        settings,
        accounts?.allowed ?? null,
        accounts?.usernames ?? [],
      );
      const codes = [...read, ...(care ? checkCare(bubbles) : [])]
        // A line she already sent him blocks the engine's draft only: sending it again is the chatter's call.
        .filter((v) => v.severity === 'blocking' && v.code !== 'repetition')
        .map((v) => v.code);
      return { isBlocked: codes.length > 0, codes: [...new Set(codes)] };
    },
  };
}
