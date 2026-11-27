import {
  CopilotSaleBlockSchema,
  type CopilotDraftReason,
  type CopilotTrace,
  type SaleCondition,
  type SaleMoment,
  type ScriptStart,
} from '@impera/contracts';

import type { DesireReading } from './desire';
import type { LanguageDecision } from './language';
import { paidWaiting, type PlatformScriptView, type ScriptRun } from './script-run';
import type { ScriptTurn } from './script-turn';

/**
 * ADR 0141 lot a: what the code decided with a draft, as the copilot panel reads it, from the turn the composer already
 * computed: no model, no new rule. Codes and numbers only; the server words them from the closed lists of contracts.
 */
export interface CopilotTraceInput {
  /** Why the brain's offer was not written, when it was not. */
  readonly offerRefused?: string;
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

/** The blocks of the script gate, as the moment to sell names them (§ 4 bis). */
const GATE_CONDITIONS: Readonly<Record<string, SaleCondition>> = {
  desire_below_threshold: 'desire_below_threshold',
  low_desire: 'desire_below_threshold',
  not_sexualizing: 'not_sexualizing',
  availability_unconfirmed: 'availability_unconfirmed',
  cooldown: 'cooldown',
  no_budget: 'no_budget',
  age_unconfirmed: 'age_unconfirmed',
};

/** Blocks under which there is no moment to sell at all: the panel shows the cut, never a gauge (§ 4 bis, § 9). */
const NO_MOMENT_BLOCKS = new Set(['do_not_contact', 'risk', 'sales_frozen']);

type Move = CopilotTrace['move'];

function moveOf(input: CopilotTraceInput, block: Move['block']): Move {
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
  if (input.offerRefused !== undefined && (block !== null || input.offerRefused in GATE_CONDITIONS))
    return { kind: 'no_sale', priceMinor: null, block };
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
 * missing; soon when one condition is missing; not yet beyond. `null` without her scripts, or under a block that leaves
 * no moment at all.
 */
function momentOf(input: CopilotTraceInput, block: Move['block'], run: ScriptRun | null): SaleMoment | null {
  if (input.care || (block !== null && NO_MOMENT_BLOCKS.has(block))) return null;
  if (input.scripts === undefined && input.scriptStart === undefined) return null;
  const missing = new Set<SaleCondition>();
  if (input.scriptStart !== undefined && !input.scriptStart.open)
    for (const code of input.scriptStart.missing) missing.add(code);
  const refused = input.offerRefused === undefined ? undefined : GATE_CONDITIONS[input.offerRefused];
  if (refused !== undefined) missing.add(refused);
  if (run !== null && paidWaiting(run) !== undefined) missing.add('step_waiting');
  const decision = input.scripts?.decision;
  const offered =
    (decision?.kind === 'start' || decision?.kind === 'send_step') && decision.step.kind === 'paid';
  if (offered) return { verdict: 'good', conditions: [] };
  const conditions = [...missing].slice(0, 3).map((code) => ({ code, met: false }));
  return {
    verdict: missing.size === 0 ? 'good' : missing.size === 1 ? 'soon' : 'not_yet',
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
  const parsed = CopilotSaleBlockSchema.safeParse(input.offerRefused);
  const block = parsed.success ? parsed.data : null;
  const run = runOf(input);
  const reasons: CopilotDraftReason[] = [];
  if (input.care) reasons.push('care');
  if (input.rewritten) reasons.push('rewritten_once');
  return {
    move: input.care ? { kind: 'reply', priceMinor: null, block: null } : moveOf(input, block),
    reasons,
    sale: input.care ? null : saleOf(input, run),
    saleMoment: momentOf(input, block, run),
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
