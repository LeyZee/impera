import type { SaleTroubleKind } from '@impera/contracts';

/**
 * A sale that goes wrong for him (ADR 0156 § 4 and § 7, ADR 0158 § 48): she answers it once herself, and the same
 * trouble again soon after goes to a human. The brain only reads his message (`payment_help`, `complaint`); code
 * decides, from when she last answered the same trouble.
 */

export type { SaleTroubleKind };

/** When she last answered each trouble for him, as the conversation's journal keeps it; `null`: never. */
export interface SaleTroubleSeen {
  readonly paymentHelpAt: Date | null;
  readonly complaintAt: Date | null;
}

export const NO_SALE_TROUBLE: SaleTroubleSeen = { paymentHelpAt: null, complaintAt: null };

const HOUR_MS = 3_600_000;

/**
 * How long her answer to a trouble counts as « just given »: the same evening for a payment he cannot make, two
 * days for a complaint about what he bought. Past it, the trouble is a new one and she answers it again herself.
 */
const STILL_FRESH_MS: Readonly<Record<SaleTroubleKind, number>> = {
  payment_help: 2 * HOUR_MS,
  purchase_complaint: 48 * HOUR_MS,
};

/** What code does with the trouble his message brings: she answers it, or a human takes over. */
export type SaleTroubleOutcome =
  | { readonly kind: 'answer'; readonly trouble: SaleTroubleKind }
  | { readonly kind: 'handoff'; readonly trouble: SaleTroubleKind };

const lastOf = (seen: SaleTroubleSeen, trouble: SaleTroubleKind): Date | null =>
  trouble === 'payment_help' ? seen.paymentHelpAt : seen.complaintAt;

/** The same trouble again while her last answer to it is fresh: she already tried, a human answers now. */
export function saleTroubleOutcome(
  trouble: SaleTroubleKind,
  seen: SaleTroubleSeen,
  now: Date,
): SaleTroubleOutcome {
  const last = lastOf(seen, trouble);
  const fresh = last !== null && now.getTime() - last.getTime() < STILL_FRESH_MS[trouble];
  return { kind: fresh ? 'handoff' : 'answer', trouble };
}

/**
 * His message complains about something he bought (ADR 0156 § 7): the brain reads a complaint or a dispute, and he
 * did buy from her (a step of a script, or any spending Reveal records). A complaint with nothing bought is no
 * purchase complaint: she answers it as any other message.
 */
export function complainsOfPurchase(input: {
  readonly intent: string;
  readonly risks: readonly string[];
  readonly hasBought: boolean;
}): boolean {
  return input.hasBought && (input.intent === 'complaint' || input.risks.includes('dispute'));
}
