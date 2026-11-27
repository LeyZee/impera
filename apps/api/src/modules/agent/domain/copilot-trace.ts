import type {
  CopilotDraftReason,
  CopilotSaleBlock,
  CopilotTrace,
  SaleCondition,
  SaleMoment,
  ScriptStart,
} from '@impera/contracts';

import type { DesireReading } from './desire';
import type { LanguageDecision } from './language';
import { paidWaiting, type NoScriptReason, type PlatformScriptView, type ScriptRun } from './script-run';
import type { ScriptTurn } from './script-turn';
import type { OfferRefusal } from './turn-sale';

/**
 * ADR 0141 lot a: what the code decided with a draft, as the copilot panel reads it, from the turn the composer already
 * computed: no model, no new rule. Codes and numbers only; the server words them from the closed lists of contracts.
 */
export interface CopilotTraceInput {
  /** Why the brain's offer was not written, when it was not. */
  readonly offerRefused?: OfferRefusal;
  /** What her answer does with his custom order: refused, or waiting for the team. */
  readonly customOrder?: 'decline' | 'wait';
  /** A reply of her objection bank was given to the voice. */
  readonly objectionAnswered: boolean;
  readonly scripts?: ScriptTurn;
  /** Her catalogue and his run as stored before this message: where the sale stands when nothing moved. */
  readonly catalogue: readonly PlatformScriptView[];
  readonly latest: ScriptRun | null;
  readonly scriptStart?: ScriptStart;
  readonly desireRead?: DesireReading;
  readonly care: boolean;
  /** Her first answer was refused by a guard and written once more. */
  readonly rewritten: boolean;
  /** The language code decided for the draft (ADR 0168). */
  readonly language?: LanguageDecision;
}

/**
 * Every code the engine refuses a sale with at a message: the brain's offer refused (`OfferRefusal`), or her scripts'
 * own reason for no step (`NoScriptReason`), read behind `no_script_step`.
 */
export type EngineRefusal = OfferRefusal | NoScriptReason;

/**
 * How the panel reads a refusal of the engine (audit 27/11): the block it names, the condition of the moment to sell it
 * stands for, and how long it lasts, from the engine's own rule. The panel never says « Bon moment » while the engine
 * refuses, and says « Pas encore » for a refusal that holds at least the evening.
 */
interface RefusalReading {
  /**
   * `no_moment`: no moment to sell at all; `tonight`: not again this evening, as far as the engine knows; `session`: it
   * may lift within this session; `none`: the engine itself refuses nothing.
   */
  readonly lasts: 'no_moment' | 'tonight' | 'session' | 'none';
  readonly block?: CopilotSaleBlock;
  readonly condition?: SaleCondition;
}

const REFUSALS: Readonly<Record<EngineRefusal, RefusalReading>> = {
  // § 9: under these, the panel shows the cut, never a gauge.
  do_not_contact: { lasts: 'no_moment', block: 'do_not_contact' },
  risk: { lasts: 'no_moment', block: 'risk' },
  sales_frozen: { lasts: 'no_moment', block: 'sales_frozen' },
  // Her persona sets no rhythm of scripts: nothing sells until it does.
  no_offer_context: { lasts: 'no_moment' },
  // Until he or a human confirms it, which may happen in this conversation.
  age_unconfirmed: { lasts: 'session', block: 'age_unconfirmed', condition: 'age_unconfirmed' },
  // Until he comes back to paid content himself, or « à sec » until his pay (`offerDecision`).
  no_budget: { lasts: 'tonight', block: 'no_budget', condition: 'no_budget' },
  // `sameEvening`: at least her cooldown between two scripts, never before her next day.
  cooldown: { lasts: 'tonight', block: 'cooldown', condition: 'cooldown' },
  // `inPauseAfterPurchase`: 24 to 72 hours after his last purchase, 48 by default (ADR 0128 § 1).
  after_purchase: { lasts: 'tonight', block: 'after_purchase' },
  // ADR 0156 § 6: he came, nothing is sold that evening.
  he_came: { lasts: 'tonight', block: 'he_came' },
  // His heat and the gate before a script (§ 4 bis): within the session.
  low_desire: { lasts: 'session', block: 'low_desire', condition: 'desire_below_threshold' },
  desire_below_threshold: { lasts: 'session', condition: 'desire_below_threshold' },
  not_sexualizing: { lasts: 'session', condition: 'not_sexualizing' },
  availability_unconfirmed: { lasts: 'session', condition: 'availability_unconfirmed' },
  // The hot session ended with his heat (ADR 0098 § 12): it comes back with it.
  cold_session: { lasts: 'session', condition: 'desire_below_threshold' },
  // He left mid-script: she teases him first, then the script may go on.
  abandon_tease: { lasts: 'session' },
  // No step decided, for no reason of her scripts: this message only.
  no_script_step: { lasts: 'session' },
  // Something else answers this message (a custom order, an objection, a guard): this message only.
  held: { lasts: 'session' },
  // A few messages of his after he bought a step, then the next one (passe 04).
  in_tension: { lasts: 'session' },
  // Until Reveal's history reads again, or the team changes her catalogue: nobody knows when.
  no_history: { lasts: 'tonight' },
  no_script: { lasts: 'tonight' },
  scripts_exhausted: { lasts: 'tonight' },
  price_mismatch: { lasts: 'tonight' },
  // The staircase (ADR 0098, avenant du 27/11/2026): nothing above his last paid step, or above the cap at the start.
  limit_reached: { lasts: 'tonight' },
  capped_at_start: { lasts: 'tonight' },
  // She picked none of the scripts allowed: the engine refused nothing.
  no_pick: { lasts: 'none' },
};

/**
 * The engine's refusal at this message: the brain's offer refused, read behind `no_script_step` in her scripts' own
 * reason; without an offer of the brain, her scripts' reason for no step, since the panel says the moment all the same.
 */
function refusalOf(input: CopilotTraceInput): EngineRefusal | undefined {
  const decision = input.scripts?.decision;
  const behind =
    decision?.kind === 'none'
      ? decision.reason
      : decision?.kind === 'wait' && 'reason' in decision
        ? decision.reason
        : undefined;
  if (input.offerRefused === 'no_script_step') return behind ?? input.offerRefused;
  return input.offerRefused ?? (decision?.kind === 'none' ? decision.reason : undefined);
}

type Move = CopilotTrace['move'];

function moveOf(input: CopilotTraceInput, refusal: EngineRefusal | undefined): Move {
  const none = { priceMinor: null, block: null };
  if (input.customOrder === 'decline') return { kind: 'custom_order_decline', ...none };
  if (input.customOrder === 'wait') return { kind: 'custom_order_wait', ...none };
  if (input.objectionAnswered) return { kind: 'answer_objection', ...none };
  const decision = input.scripts?.decision;
  if (decision?.kind === 'start' || decision?.kind === 'send_step') {
    const price = decision.step.kind === 'paid' ? decision.step.priceMinor : null;
    return price === null
      ? { kind: 'reply', ...none }
      : { kind: 'offer_step', priceMinor: price, block: null };
  }
  if (decision?.kind === 'wait' && 'step' in decision) return { kind: 'wait', ...none };
  if (refusal === undefined) return { kind: 'reply', ...none };
  const reading = REFUSALS[refusal];
  const named = reading.block !== undefined || reading.condition !== undefined;
  // Her offer refused with its reason; without an offer of hers, only what holds the evening, so she sells nothing.
  if (named && (input.offerRefused !== undefined || reading.lasts === 'tonight'))
    return { kind: 'no_sale', priceMinor: null, block: reading.block ?? null };
  return { kind: 'reply', ...none };
}

/**
 * His run after this message: the one opened or moved (even ended by it, a refusal shows its step), else the one stored
 * while it is open.
 */
function runOf(input: CopilotTraceInput): ScriptRun | null {
  const changed = input.scripts?.opened?.run ?? input.scripts?.moved?.run;
  if (changed !== undefined) return changed;
  return input.latest?.status === 'open' ? input.latest : null;
}

/** A script's name for the panel: the start of its description, cut on a word; its rank otherwise. */
const NAME_MAX = 60;
function scriptNameOf(script: PlatformScriptView): string {
  const text = script.description.replace(/\s+/gu, ' ').trim();
  if (text.length === 0) return 'Script en cours';
  if (text.length <= NAME_MAX) return text;
  const cut = text.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function saleOf(input: CopilotTraceInput, run: ScriptRun | null): CopilotTrace['sale'] {
  if (run === null) return null;
  const script =
    input.scripts?.script?.scriptRef === run.scriptRef
      ? input.scripts.script
      : input.catalogue.find((one) => one.scriptRef === run.scriptRef);
  const current = run.steps.at(-1);
  if (script === undefined || script.steps.length === 0 || current === undefined) return null;
  const decision = input.scripts?.decision;
  const decided =
    (decision?.kind === 'start' || decision?.kind === 'send_step') &&
    decision.step.scriptRef === run.scriptRef
      ? decision.step
      : null;
  // The step decided with this draft, else the first paid step after the current one.
  const nextIndex =
    decided !== null && decided.kind === 'paid'
      ? decided.stepIndex
      : script.steps.findIndex((step, index) => index > current.stepIndex && step.kind === 'paid');
  // An ended run offers nothing more: never the step he refused, nor any after it.
  const nextPrice =
    nextIndex < 0 || run.status !== 'open' ? null : (script.steps[nextIndex]?.priceMinor ?? null);
  return {
    scriptRef: run.scriptRef,
    scriptName: scriptNameOf(script),
    stepIndex: current.stepIndex,
    stepCount: script.steps.length,
    nextStep:
      nextIndex < 0 || nextPrice === null || nextPrice <= 0
        ? null
        : { stepIndex: nextIndex, priceMinor: decided?.priceMinor ?? nextPrice },
    refusedStepIndexes: run.steps.filter((step) => step.outcome === 'refused').map((step) => step.stepIndex),
    offerPending: paidWaiting(run) !== undefined,
  };
}

/**
 * § 4 bis: the verdict from the same guards as the paid step. Good when a paid step goes with this draft or nothing is
 * missing; soon when one condition is missing; not yet beyond, or under a refusal of the engine that holds the evening
 * (audit 27/11). `null` without her scripts, or under a refusal that leaves no moment at all.
 */
function momentOf(
  input: CopilotTraceInput,
  refusal: EngineRefusal | undefined,
  run: ScriptRun | null,
): SaleMoment | null {
  const reading = refusal === undefined ? undefined : REFUSALS[refusal];
  if (input.care || reading?.lasts === 'no_moment') return null;
  if (input.scripts === undefined && input.scriptStart === undefined) return null;
  const missing = new Set<SaleCondition>();
  if (input.scriptStart !== undefined && !input.scriptStart.open)
    for (const code of input.scriptStart.missing) missing.add(code);
  if (reading?.condition !== undefined) missing.add(reading.condition);
  if (run !== null && paidWaiting(run) !== undefined) missing.add('step_waiting');
  const decision = input.scripts?.decision;
  const offered =
    (decision?.kind === 'start' || decision?.kind === 'send_step') && decision.step.kind === 'paid';
  if (offered) return { verdict: 'good', conditions: [] };
  const conditions = [...missing].slice(0, 3).map((code) => ({ code, met: false }));
  // A refusal no condition names still counts as one thing missing: the engine refuses, never « Bon moment ».
  const unnamed =
    reading !== undefined && reading.lasts !== 'none' && reading.condition === undefined ? 1 : 0;
  const count = missing.size + unnamed;
  return {
    verdict: reading?.lasts === 'tonight' || count > 1 ? 'not_yet' : count === 1 ? 'soon' : 'good',
    conditions,
  };
}

function trendOf(reading: DesireReading | undefined): CopilotTrace['desireTrend'] {
  if (reading?.before === undefined || reading.before === null) return null;
  if (reading.score > reading.before) return 'up';
  if (reading.score < reading.before) return 'down';
  return 'flat';
}

export function copilotTrace(input: CopilotTraceInput): CopilotTrace {
  const refusal = refusalOf(input);
  const run = runOf(input);
  const reasons: CopilotDraftReason[] = [];
  if (input.care) reasons.push('care');
  if (input.rewritten) reasons.push('rewritten_once');
  return {
    move: input.care ? { kind: 'reply', priceMinor: null, block: null } : moveOf(input, refusal),
    reasons,
    sale: input.care ? null : saleOf(input, run),
    saleMoment: momentOf(input, refusal, run),
    desireTrend: trendOf(input.desireRead),
    ...(input.language !== undefined && {
      language: {
        reply: input.language.reply,
        fan: input.language.fan,
        humanOnly: input.language.humanOnly,
      },
    }),
    ...(input.scripts?.stepPrice !== undefined && { stepPrice: input.scripts.stepPrice }),
  };
}
