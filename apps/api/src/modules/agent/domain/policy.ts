import { normalise, type FanFlags } from '@impera/contracts';

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
  /** Her time zone: the same evening never ends before her next day. Absent, only her cooldown counts. */
  readonly timeZone?: string;
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
  'insult',
  'dispute',
];

const HOUR_MS = 3_600_000;

/**
 * « Jamais deux scripts le même soir » (ADR 0158 § 42, guide 26/11): the same evening lasts at least her cooldown
 * between two scripts, and never ends before the next day where she lives. His asking lifts neither.
 */
export function sameEvening(
  now: Date,
  at: Date,
  cooldownHours: number,
  timeZone: string | undefined,
): boolean {
  if (now.getTime() - at.getTime() < cooldownHours * HOUR_MS) return true;
  return timeZone !== undefined && localDay(now, timeZone) === localDay(at, timeZone);
}

function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function offerDecision(context: OfferContext): OfferDecision {
  const { flags, limits } = context;
  if (flags.doNotContact === true) return { allowed: false, reason: 'do_not_contact' };
  if (context.risks.some((risk) => NO_SALE_RISKS.includes(risk))) return { allowed: false, reason: 'risk' };
  // Frozen because he said he cannot pay: that one lifts when he comes back to paid content himself, like `hasNoBudget`.
  // « À sec » until his pay (ADR 0158 § M 52): no sale while the brain still reads it, and no flag set on him.
  const noBudget =
    context.hasNoBudget ||
    context.risks.includes('no_budget') ||
    flags.salesFrozen?.reason === 'money_trouble';
  if (flags.salesFrozen !== undefined && !noBudget) return { allowed: false, reason: 'sales_frozen' };
  // A script is explicit content: never before he is confirmed an adult.
  if (flags.ageConfirmedAt === undefined) return { allowed: false, reason: 'age_unconfirmed' };
  // Never two scripts the same evening, his asking or not.
  if (
    context.lastOfferAt !== null &&
    sameEvening(context.now, context.lastOfferAt, limits.cooldownHours, context.timeZone)
  )
    return { allowed: false, reason: 'cooldown' };
  // He came back to paid content himself: no waiting on his budget nor his heat.
  if (context.fanAsksForPaid) return { allowed: true };
  if (noBudget) return { allowed: false, reason: 'no_budget' };
  // His heat replaces « he sexualizes now » (P3-12): a single flirty line is not a hot fan.
  if (context.desire < limits.minDesire) return { allowed: false, reason: 'low_desire' };
  return { allowed: true };
}

/**
 * He asks for more paid content within the evening of her last script (passe 18, Charles 21/11): nothing more is
 * offered tonight; she steers him to a custom request instead, never a yes nor a price before the creator agrees.
 */
export function asksMoreSameEvening(
  context: Pick<OfferContext, 'now' | 'lastOfferAt' | 'fanAsksForPaid' | 'limits' | 'timeZone'>,
): boolean {
  return (
    context.fanAsksForPaid &&
    context.lastOfferAt !== null &&
    sameEvening(context.now, context.lastOfferAt, context.limits.cooldownHours, context.timeZone)
  );
}

/**
 * Broke until his pay but a fan who already paid (passe 11a, Charles 21/11): she keeps him warm, words only. No offer
 * and no media this time, no freeze and no flag on him. A fan who never paid keeps the plain no-budget stop.
 */
export function keepsWarm(context: {
  readonly risks: readonly string[];
  readonly hasBought: boolean;
}): boolean {
  return (
    context.hasBought &&
    context.risks.includes('no_budget') &&
    !context.risks.some((risk) => NO_SALE_RISKS.includes(risk))
  );
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
 * What makes his message a sexual advance, for the cursor that may slow him down (P3-09): he sexts, or says in his own
 * words what he wants, takes her there, or plays a sexual role. A flirt, a compliment, his mood alone or a question on
 * her outfit is not one: a compliment, even an insistent one, is welcomed, never slowed down (Charles, 16/11). The gate
 * of the first teaser reads a wider sign (`sexualizes`, ADR 0103 § 11): a sale may wait for less than a brake needs.
 */
const SEXUAL_ADVANCE_SIGNALS: readonly string[] = [
  'explicit_language',
  'states_desire',
  'steers_to_intimate',
  'roleplay',
];

/**
 * What still makes a flirt an advance (Charles, 20/11): explicit words or a sexual role, read by the brain.
 */
const FLIRT_ADVANCE_SIGNALS: readonly string[] = ['explicit_language', 'roleplay'];

/** A desire or a pull to the intimate, which on a flirt counts only when his own words carry it. */
const FLIRT_DESIRE_SIGNALS: readonly string[] = ['states_desire', 'steers_to_intimate'];

/**
 * His own words say desire (relecture Bilan de #888): « j'ai trop envie de toi », « tu m'excites », « dans mon lit ».
 * A compliment never matches: « t'es trop belle », « j'ai envie de te parler », « ton sourire ».
 */
const DESIRE_MARKER =
  /\b(?:(?:envie|besoin) de (?:toi|te (?:sentir|toucher|gouter|caresser|prendre|baiser|lecher|devorer)|ton corps|ta bouche)|je te (?:veux|desire)|(?:tu|ca) m'excite|t'es (?:trop )?excitante|excite(?:e|s)?|bande(?:r|s)?|mouill\w*|chaud(?:e|s)? (?:pour|de) toi|te (?:baiser|lecher|prendre|devorer)|dans (?:mon|ton) lit|a poil|toute nue|sous la couette avec)\b/u;

/**
 * His message is an advance (ADR 0103 § 11, Charles 20/11). The brain names it a flirt and still adds a desire to a
 * stranger's compliment: on a flirt, a desire or a pull to the intimate counts only when his words carry it
 * (`DESIRE_MARKER`), explicit words or a role always. Without his text, only these two. An open doubt on his age is a
 * risk, read elsewhere, and still stops her.
 */
export function flirtAdvances(desireSignals: readonly string[], fanText: string | undefined): boolean {
  if (desireSignals.some((signal) => FLIRT_ADVANCE_SIGNALS.includes(signal))) return true;
  return (
    fanText !== undefined &&
    desireSignals.some((signal) => FLIRT_DESIRE_SIGNALS.includes(signal)) &&
    DESIRE_MARKER.test(normalise(fanText))
  );
}

/**
 * What the brain read that the policy needs: he makes a sexual advance now (the cursor follows him there or slows him
 * down), or asks for paid content himself.
 */
export function offerSignals(
  brief: {
    readonly intent: string;
    readonly sentiment: string;
    readonly desireSignals?: readonly string[] | undefined;
  },
  fanText?: string,
): {
  readonly fanSexualizes: boolean;
  readonly fanAsksForPaid: boolean;
} {
  return {
    fanSexualizes:
      brief.intent === 'sexting' ||
      (brief.intent === 'flirt'
        ? flirtAdvances(brief.desireSignals ?? [], fanText)
        : (brief.desireSignals ?? []).some((signal) => SEXUAL_ADVANCE_SIGNALS.includes(signal))),
    fanAsksForPaid: brief.intent === 'asks_for_media',
  };
}
