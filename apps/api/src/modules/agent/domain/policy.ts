import type { FanFlags } from '@nirvana/contracts';

/**
 * When she may offer a script (docs/sessions/tasks/PROPOSED-sales-policy.md, Charles 17/10 22h00): one script per
 * cooldown, only when he is hot (his desire score, P3-12), and none once he says he has no money. Pure code: the
 * brain may suggest an offer, only this decides.
 */

export interface OfferLimits {
  /** Minimum time between two scripts to one fan; per creator, set in the CRM (persona `strategies.script_launch.cooldown_hours`). */
  readonly cooldownHours: number;
  /** His desire score before a script may go out (persona `strategies.script_launch.min_desire`, default 70). */
  readonly minDesire: number;
}

export interface OfferContext {
  readonly now: Date;
  /** When the last script was offered to him, bought or not. */
  readonly lastOfferAt: Date | null;
  /** His desire score after his message (`desireScore`, P3-12): a script follows his heat, never opens it. */
  readonly desire: number;
  /**
   * He asks for paid content himself (« tu as des vidéos ? »): the cooldown, the no-budget stop and the desire score
   * are lifted.
   */
  readonly fanAsksForPaid: boolean;
  /** Set by code when he says he cannot pay; lifted only when he comes back to paid content himself. */
  readonly hasNoBudget: boolean;
  readonly risks: readonly string[];
  /** His limits (`fans.flags`, P3-02), set by the policy or a human: none of them is lifted by his asking. */
  readonly flags: FanFlags;
  /** Hers, read from her persona (`PersonaForModels.offerLimits`). */
  readonly limits: OfferLimits;
}

export type OfferBlock =
  'do_not_contact' | 'risk' | 'sales_frozen' | 'age_unconfirmed' | 'no_budget' | 'cooldown' | 'low_desire';

export type OfferDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: OfferBlock };

/** A risk where selling is out of the question, whatever else happens. */
export const NO_SALE_RISKS: readonly string[] = [
  'money_trouble',
  'distress',
  'self_harm',
  'minor_suspected',
  'dangerous_request',
  'real_abuse',
  'harassment',
  'dispute',
];

const HOUR_MS = 3_600_000;

export function offerDecision(context: OfferContext): OfferDecision {
  const { flags, limits } = context;
  if (flags.doNotContact === true) return { allowed: false, reason: 'do_not_contact' };
  if (context.risks.some((risk) => NO_SALE_RISKS.includes(risk))) return { allowed: false, reason: 'risk' };
  // Frozen because he said he cannot pay: that one lifts when he comes back to paid content himself, like `hasNoBudget`.
  const noBudget = context.hasNoBudget || flags.salesFrozen?.reason === 'money_trouble';
  if (flags.salesFrozen !== undefined && !noBudget) return { allowed: false, reason: 'sales_frozen' };
  // A script is explicit content: never before he is confirmed an adult.
  if (flags.ageConfirmedAt === undefined) return { allowed: false, reason: 'age_unconfirmed' };
  // He came back to paid content himself: no waiting on the cooldown or on his budget.
  if (context.fanAsksForPaid) return { allowed: true };
  if (noBudget) return { allowed: false, reason: 'no_budget' };
  if (
    context.lastOfferAt !== null &&
    context.now.getTime() - context.lastOfferAt.getTime() < limits.cooldownHours * HOUR_MS
  ) {
    return { allowed: false, reason: 'cooldown' };
  }
  // His heat replaces « he sexualizes now » (P3-12): a single flirty line is not a hot fan.
  if (context.desire < limits.minDesire) return { allowed: false, reason: 'low_desire' };
  return { allowed: true };
}

/**
 * The scripts she may still offer him: never one he already refused, whatever day it was (méthode, « jamais
 * reproposer un pack refusé »). Reveal's script history is the source of truth for what he was offered (ADR 0018).
 */
export function offerableScripts<T extends { readonly id: string }>(
  scripts: readonly T[],
  refusedIds: ReadonlySet<string>,
): T[] {
  return scripts.filter((script) => !refusedIds.has(script.id));
}

/** Whether she may sulk after a refusal (méthode §4): never with sales frozen, a fragile fan, or one not to write to. */
export function maySulk(flags: FanFlags): boolean {
  return flags.salesFrozen === undefined && flags.fragile !== true && flags.doNotContact !== true;
}

/**
 * What the brain read that the policy needs: he sexualizes now (the cursor follows him there), or asks for paid
 * content himself.
 */
export function offerSignals(brief: { readonly intent: string; readonly sentiment: string }): {
  readonly fanSexualizes: boolean;
  readonly fanAsksForPaid: boolean;
} {
  return {
    fanSexualizes: brief.intent === 'flirt' || brief.intent === 'sexting' || brief.sentiment === 'aroused',
    fanAsksForPaid: brief.intent === 'asks_for_media',
  };
}
