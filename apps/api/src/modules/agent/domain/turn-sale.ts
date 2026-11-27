import { normalise, type ObjectionReplies } from '@impera/contracts';

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
import { wantsMadeForHim } from './sexting-moves';
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

// He asks for more of what she sends (passe 18): « t'as encore quelque chose », « montre-moi autre chose », « another
// one », « algo más », « un'altra ». Read on his messages since his purchase this evening.
const ASKS_MORE_TONIGHT =
  /\b(encore (une?|des|du|de la|quelque chose|autre chose|plus)|t'?as encore|tu as encore|autre chose|une autre|un autre|la suite|montre[- ]moi|envoie[- ]moi|j'?en veux (encore|plus)|(some|any) ?more|another (one|video|pic|photo)|something else|show me|send me|otra|otro|algo mas|ensename|mandame|un'?altra|un altro|qualcos'?altro|ancora|fammi vedere|mandami)\b/;

/**
 * After his script, he asks for more again, or asks something made for him (Charles 27/11): only then may she steer
 * him to a cam or a video made for him. His first « t'as encore quelque chose ? » gets tenderness and nothing proposed
 * (passe 3 du 27/11, conversation 18): a cam or a custom video is never volunteered. An earlier ask counts only when
 * written after his last purchase in the run (dated messages; undated ones do not count, closed by default).
 */
export function insistsMoreTonight(
  fanText: string,
  history: readonly HistoryTurn[],
  latestRun: ScriptRun | null | undefined,
): boolean {
  if (wantsMadeForHim(fanText)) return true;
  const boughtAt = lastBoughtStepAt(latestRun);
  if (boughtAt === null) return false;
  // His messages she already answered: the ones after her last answer are those she answers now.
  const earlier = history.slice(
    0,
    history.findLastIndex((turn) => turn.from === 'creator'),
  );
  return earlier.some(
    (turn) =>
      turn.from === 'fan' &&
      turn.at !== undefined &&
      turn.at >= boughtAt &&
      ASKS_MORE_TONIGHT.test(normalise(turn.text)),
  );
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

/** His last messages read for a cam or a video he asked for himself. */
const ASKED_CUSTOM_MESSAGES = 3;

/**
 * Whether her answer may not propose a cam or a video made for him (Charles 27/11, guard `custom_unasked`): nothing in
 * code steers him to it now (a custom order, his insisting after his script, his wish mid-script, a fantasy no script
 * serves), no step of her script is in the answer, and he asked for none in his last messages nor the brain read one.
 */
export function customUnaskedNow(facts: {
  readonly customLed: boolean;
  readonly hasStep: boolean;
  readonly intent: string | undefined;
  readonly fanText: string;
  readonly history: readonly HistoryTurn[];
}): boolean {
  if (facts.customLed || facts.hasStep || facts.intent === 'asks_for_service') return false;
  const his = facts.history.filter((turn) => turn.from === 'fan').slice(-ASKED_CUSTOM_MESSAGES);
  return ![facts.fanText, ...his.map((turn) => turn.text)].some(wantsMadeForHim);
}
