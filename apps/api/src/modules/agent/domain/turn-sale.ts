import type { ObjectionReplies } from '@impera/contracts';

import type { ScriptStart, ScriptStartBlock } from './availability';
import type { CustomOrderDecision } from './custom-order';
import { pickObjectionReply, type PickedObjectionReply } from './objections';
import {
  asksMoreSameEvening,
  maySuggestCustom,
  offerDecision,
  offerSignals,
  type OfferBlock,
} from './policy';
import { refusalMove, type RefusalMove } from './refusal';
import {
  complainsOfPurchase,
  NO_SALE_TROUBLE,
  saleTroubleOutcome,
  type SaleTroubleOutcome,
  type SaleTroubleSeen,
} from './sale-trouble';
import { scriptStepsHeld, type ScriptRun } from './script-run';
import type { ScriptTurn } from './script-turn';
import type { Situation } from './situation';
import type { TurnReading } from './turn-briefs';
import { herAnswersSince, type HistoryTurn } from './turn-history';
import { waitingStepOf, type OfferInput, type ScriptsInput, type WaitingStep } from './turn-scripts';

/**
 * Why the brain's offer was not written: the policy's reason, nothing to decide on, or, with her scripts read, no step
 * of a script decided (she offers only what a script sends, ADR 0098).
 */
export type OfferRefusal =
  OfferBlock | ScriptStartBlock | 'no_offer_context' | 'no_script_step' | 'he_came' | 'abandon_tease';

export function offerRefusal(
  brief: TurnReading,
  offer: OfferInput | undefined,
  desire: number,
): OfferRefusal | undefined {
  if (offer === undefined) return 'no_offer_context';
  const { fanAsksForPaid, fanSexualizes } = offerSignals(brief);
  const decision = offerDecision({ ...offer, desire, fanAsksForPaid, fanSexualizes, risks: brief.risks });
  return decision.allowed ? undefined : decision.reason;
}

/**
 * The brain may suggest an offer, only the policy decides (CLAUDE.md rule 3): refused, she just answers. With her
 * scripts read, she offers only the step code decided.
 */
export function offerRefusedOf(facts: {
  readonly cursored: TurnReading;
  readonly hasScriptStep: boolean;
  readonly heCame: boolean;
  readonly teasing: boolean;
  readonly scriptsDecide: boolean;
  readonly scriptStart: ScriptStart | undefined;
  readonly offer: OfferInput | undefined;
  readonly heat: number;
}): OfferRefusal | undefined {
  const { cursored, scriptStart } = facts;
  return cursored.action !== 'offer' || facts.hasScriptStep
    ? undefined
    : facts.heCame
      ? 'he_came'
      : facts.teasing
        ? 'abandon_tease'
        : facts.scriptsDecide
          ? 'no_script_step'
          : scriptStart !== undefined && !scriptStart.open
            ? (scriptStart.missing[0] ?? 'availability_unconfirmed')
            : offerRefusal(cursored, facts.offer, facts.heat);
}

/** His price objection: a reply of her bank he never received, said in her words (ADR 0090 § B). */
export function objectionReplyOf(
  brief: TurnReading | undefined,
  care: boolean,
  trapped: boolean,
  objections: { readonly bank: ObjectionReplies; readonly usedReplyIds: ReadonlySet<string> } | undefined,
): PickedObjectionReply | undefined {
  return !care && brief?.intent === 'price_objection' && !trapped && objections !== undefined
    ? pickObjectionReply(objections.bank, brief.objection, objections.usedReplyIds)
    : undefined;
}

/** What leads her answer at this message besides the brain's reading: each stops the sale moves below. */
export interface SaleLeads {
  readonly care: boolean;
  readonly hasScriptStep: boolean;
  readonly customOrder: CustomOrderDecision | undefined;
  readonly objectionReply: PickedObjectionReply | undefined;
  readonly trapped: boolean;
  readonly steersBack: boolean;
}

/** The moves after a sale of hers at this message: his refusal, her step unopened, his trouble paying or with it. */
export interface SaleMoves {
  /** He just said no to her paid step: she asks why, insists once, sulks once at most, then lets go (ADR 0156 § 3). */
  readonly refusal: RefusalMove | null;
  /** He comes back after the session cooled, her paid step unopened: one light reminder, never a sale (ADR 0156 § 1). */
  readonly reminds: boolean;
  /** A sale gone wrong (ADR 0156 § 4 and § 7): she answers it once; the same trouble again soon after goes to a human. */
  readonly saleTrouble: SaleTroubleOutcome | undefined;
  /** The step waiting he asks how to open, as the voice reads it; absent once a human answers his trouble. */
  readonly waitingStep: WaitingStep | undefined;
  /** He complains about what he bought, and she answers it. */
  readonly complaint: boolean;
}

export function saleMovesOf(
  facts: {
    readonly brief: TurnReading | undefined;
    readonly situation: Situation;
    readonly history: readonly HistoryTurn[];
    readonly scriptsIn: ScriptsInput | undefined;
    readonly offer: OfferInput | undefined;
    readonly scripts: ScriptTurn | undefined;
    readonly heat: number;
    readonly saleTrouble: { readonly seen: SaleTroubleSeen; readonly hasBought: boolean } | undefined;
  },
  leads: SaleLeads,
): SaleMoves {
  const { brief, scripts, offer, scriptsIn, situation } = facts;
  const { care, customOrder, objectionReply } = leads;
  const refusal =
    care ||
    scripts === undefined ||
    offer === undefined ||
    leads.hasScriptStep ||
    customOrder !== undefined ||
    objectionReply !== undefined ||
    leads.trapped ||
    leads.steersBack
      ? null
      : scripts.decision.kind === 'after_refusal'
        ? 'ask_why'
        : refusalMove({
            now: situation.now,
            run: scriptsIn?.latest ?? null,
            herAnswersSince: herAnswersSince(facts.history, scriptsIn?.latest?.endedAt ?? null),
            flags: offer.flags,
            care,
          });
  const reminds =
    !care &&
    scripts?.decision.kind === 'end' &&
    scripts.decision.unopened !== undefined &&
    customOrder === undefined &&
    objectionReply === undefined &&
    !leads.trapped &&
    !leads.steersBack;
  // He asks how to pay for her step waiting: the voice sees its exact price and what it holds (ADR 0156 § 4). Every
  // stop of a sale holds: no help to buy for a fan nobody may sell to.
  const waitingStepFound =
    brief?.intent !== 'payment_help' ||
    care ||
    scripts === undefined ||
    scriptsIn === undefined ||
    offer === undefined ||
    scriptStepsHeld(offer.flags, care) ||
    // The step waits in the run he is in: « never two scripts the same evening » is not about it (ADR 0158 § 42).
    !offerDecision({
      ...offer,
      lastOfferAt: null,
      desire: facts.heat,
      fanAsksForPaid: true,
      risks: brief.risks,
    }).allowed ||
    customOrder !== undefined ||
    leads.trapped
      ? undefined
      : waitingStepOf(scripts, scriptsIn.catalogue, scriptsIn.latest?.scriptRef ?? null);
  const troubleSeen = facts.saleTrouble?.seen ?? NO_SALE_TROUBLE;
  const saleTrouble: SaleTroubleOutcome | undefined =
    waitingStepFound !== undefined
      ? saleTroubleOutcome('payment_help', troubleSeen, situation.now)
      : brief !== undefined &&
          !care &&
          complainsOfPurchase({
            intent: brief.intent,
            risks: brief.risks,
            hasBought: facts.saleTrouble?.hasBought === true,
          })
        ? saleTroubleOutcome('purchase_complaint', troubleSeen, situation.now)
        : undefined;
  // Still stuck after her help: a human answers, she does not explain the same thing twice.
  const waitingStep = saleTrouble?.kind === 'handoff' ? undefined : waitingStepFound;
  const complaint = saleTrouble?.kind === 'answer' && saleTrouble.trouble === 'purchase_complaint';
  return { refusal, reminds, saleTrouble, waitingStep, complaint };
}

/** When he last bought a paid step of this run, `null` when he bought none: the purchase, never the offer. */
function lastBoughtStepAt(run: ScriptRun | null | undefined): Date | null {
  return run?.steps.findLast((step) => step.kind === 'paid' && step.outcome === 'bought')?.at ?? null;
}

/**
 * He asks for more the evening he bought a step of his script: nothing more tonight, a custom request instead (passe
 * 18). Only after a real purchase this evening, read on his latest run; an offer made or refused is not one. Never to a
 * fan nobody may sell to, nor one who says he has no money now (`maySuggestCustom`): no custom nor cam pushed at him.
 */
export function asksMoreTonight(
  brief: Pick<TurnReading, 'intent' | 'sentiment' | 'desireSignals' | 'risks'> | undefined,
  offer: OfferInput | undefined,
  hasScriptStep: boolean,
  latestRun: ScriptRun | null | undefined,
): boolean {
  return (
    brief !== undefined &&
    offer !== undefined &&
    !hasScriptStep &&
    maySuggestCustom({ risks: brief.risks, flags: offer.flags }) &&
    asksMoreSameEvening({
      ...offer,
      fanAsksForPaid: offerSignals(brief).fanAsksForPaid,
      boughtAt: lastBoughtStepAt(latestRun),
    })
  );
}
