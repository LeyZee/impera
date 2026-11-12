import type { FanFlags } from '@impera/contracts';

import { offerDecision, type OfferBlock, type OfferContext } from './policy';
import type { DayPart } from './situation';

/**
 * The run of a script with one fan (ADR 0098): the code keeps where he is, chooses the next step and its price, and
 * the voice only says them. Pure: a run and an event give the next run; a run and the moment give one closed decision.
 */

/** A step of a sellable script: offered (no price), paid (a pack at the catalogue's price), or a bridge (offered). */
type ScriptStepKind = 'free' | 'paid' | 'bridge';

interface CatalogueStep {
  /** Its segment key (ADR 0056): never changes, whatever its number. */
  readonly key: string;
  readonly kind: ScriptStepKind;
  /** The catalogue's price, in cents, for a paid step only; `null` for an offered step or a bridge. */
  readonly priceCents: number | null;
}

/** A script of her catalogue (P6-01): what a run reads, never the workshop's structure alone (ADR 0098 § 13). */
export interface CatalogueScript {
  readonly id: string;
  /** Jour, Nuit, or both, on her clock. */
  readonly moment: DayPart | 'both';
  /** What the run is about, for the brain to pick the one that fits him (ADR 0098 § 6). */
  readonly description: string;
  readonly steps: readonly CatalogueStep[];
  /** Every media of every step described and validated (ADR 0083). */
  readonly mediaValidated: boolean;
  /** Something in it touches a limit of her persona. */
  readonly touchesLimits: boolean;
}

export type CatalogueScriptFault =
  | 'no_step'
  | 'duplicate_key'
  | 'paid_without_price'
  | 'price_on_free_step'
  | 'bridge_at_edge'
  | 'starts_with_bridge';

/** What makes a catalogue script unplayable: such a script is never offered. Empty: it is playable. */
export function catalogueScriptFaults(script: CatalogueScript): CatalogueScriptFault[] {
  const faults: CatalogueScriptFault[] = [];
  const { steps } = script;
  if (steps.length === 0) return ['no_step'];
  if (new Set(steps.map((step) => step.key)).size !== steps.length) faults.push('duplicate_key');
  for (const step of steps) {
    if (step.kind === 'paid' && (step.priceCents === null || step.priceCents <= 0))
      faults.push('paid_without_price');
    if (step.kind !== 'paid' && step.priceCents !== null) faults.push('price_on_free_step');
  }
  if (steps[0]?.kind === 'bridge') faults.push('starts_with_bridge');
  if (steps.at(-1)?.kind === 'bridge') faults.push('bridge_at_edge');
  return faults;
}

/** What became of a step sent to him. */
type StepOutcome = 'sent' | 'opened' | 'bought' | 'refused';

interface StepRecord {
  readonly key: string;
  readonly kind: ScriptStepKind;
  readonly outcome: StepOutcome;
  readonly priceCents: number | null;
  readonly sentAt: Date;
  /** When the outcome last changed. */
  readonly at: Date;
}

type ScriptRunStatus = 'open' | 'bought_out' | 'refused' | 'stalled' | 'closed_by_human';

export interface ScriptRun {
  readonly scriptId: string;
  readonly status: ScriptRunStatus;
  /** The steps sent, in order; the last one is the current step. */
  readonly steps: readonly StepRecord[];
  /** His messages in a row that ignore the paid step waiting: two make a refusal (Charles, 12/11). */
  readonly ignoredMessages: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export type ScriptRunEvent =
  | { readonly type: 'step_sent'; readonly key: string; readonly at: Date }
  | { readonly type: 'step_opened'; readonly key: string; readonly at: Date }
  | { readonly type: 'step_bought'; readonly key: string; readonly at: Date }
  /** The brain read a clear refusal of the step waiting. */
  | { readonly type: 'refused'; readonly at: Date }
  /** One message of his; `aboutTheStep`: the brain read that it answers the step waiting. */
  | { readonly type: 'fan_message'; readonly aboutTheStep: boolean; readonly at: Date }
  /** The hot session ended (his desire under her opening score): a run never resumes another session (§ 12). */
  | { readonly type: 'session_cooled'; readonly at: Date }
  /** A paid step left unopened past its follow-up (P6-02): the run stops there (§ 10). */
  | { readonly type: 'no_answer'; readonly at: Date }
  | { readonly type: 'human_took_over'; readonly at: Date };

type ScriptRunFault = 'run_closed' | 'not_next_step' | 'unknown_step' | 'nothing_waiting' | 'not_paid';

export type ScriptRunResult =
  { readonly ok: true; readonly run: ScriptRun } | { readonly ok: false; readonly fault: ScriptRunFault };

const IGNORED_MESSAGES_FOR_REFUSAL = 2;

/** A new run, its first step not sent yet. */
export function openScriptRun(scriptId: string, at: Date): ScriptRun {
  return { scriptId, status: 'open', steps: [], ignoredMessages: 0, startedAt: at, endedAt: null };
}

const current = (run: ScriptRun): StepRecord | undefined => run.steps.at(-1);

/** A paid step sent or opened, neither bought nor refused: what his messages are counted against. */
const paidWaiting = (run: ScriptRun): StepRecord | undefined => {
  const step = current(run);
  return step?.kind === 'paid' && (step.outcome === 'sent' || step.outcome === 'opened') ? step : undefined;
};

/** The step that comes after what was sent, if the last one lets it go (§ 3, § 8). `undefined`: none may go now. */
function nextStepOf(run: ScriptRun, script: CatalogueScript): CatalogueStep | 'done' | undefined {
  const last = current(run);
  if (last === undefined) return script.steps[0];
  // A paid step goes on only once bought; an offered step or a bridge once sent (a bridge after an offered step too).
  if (last.kind === 'paid' && last.outcome !== 'bought') return undefined;
  if (last.outcome === 'refused') return undefined;
  const index = script.steps.findIndex((step) => step.key === last.key);
  if (index < 0) return undefined;
  return script.steps[index + 1] ?? 'done';
}

const withLast = (run: ScriptRun, change: (step: StepRecord) => StepRecord): ScriptRun => {
  const last = current(run);
  if (last === undefined) return run;
  return { ...run, steps: [...run.steps.slice(0, -1), change(last)] };
};

const ended = (run: ScriptRun, status: Exclude<ScriptRunStatus, 'open'>, at: Date): ScriptRun => ({
  ...run,
  status,
  endedAt: at,
  ignoredMessages: 0,
});

/** The run after one event; a fault leaves it as it was (the caller logs it, never forces it). */
export function applyScriptRunEvent(
  run: ScriptRun,
  script: CatalogueScript,
  event: ScriptRunEvent,
): ScriptRunResult {
  if (run.status !== 'open') return { ok: false, fault: 'run_closed' };
  switch (event.type) {
    case 'step_sent': {
      const next = nextStepOf(run, script);
      if (next === undefined || next === 'done' || next.key !== event.key)
        return { ok: false, fault: 'not_next_step' };
      const record: StepRecord = {
        key: next.key,
        kind: next.kind,
        outcome: 'sent',
        priceCents: next.priceCents,
        sentAt: event.at,
        at: event.at,
      };
      return { ok: true, run: { ...run, steps: [...run.steps, record], ignoredMessages: 0 } };
    }
    case 'step_opened': {
      const last = current(run);
      if (last?.key !== event.key) return { ok: false, fault: 'unknown_step' };
      if (last.outcome !== 'sent') return { ok: true, run };
      return { ok: true, run: withLast(run, (step) => ({ ...step, outcome: 'opened', at: event.at })) };
    }
    case 'step_bought': {
      const last = current(run);
      if (last?.key !== event.key) return { ok: false, fault: 'unknown_step' };
      if (last.kind !== 'paid') return { ok: false, fault: 'not_paid' };
      if (last.outcome === 'bought') return { ok: true, run };
      const bought = withLast(run, (step) => ({ ...step, outcome: 'bought', at: event.at }));
      const after = { ...bought, ignoredMessages: 0 };
      return {
        ok: true,
        run: nextStepOf(after, script) === 'done' ? ended(after, 'bought_out', event.at) : after,
      };
    }
    case 'refused': {
      if (paidWaiting(run) === undefined) return { ok: false, fault: 'nothing_waiting' };
      return { ok: true, run: refuse(run, event.at) };
    }
    case 'fan_message': {
      if (paidWaiting(run) === undefined) return { ok: true, run };
      if (event.aboutTheStep) return { ok: true, run: { ...run, ignoredMessages: 0 } };
      const ignored = run.ignoredMessages + 1;
      // He ignores the paid step and talks of something else two messages in a row: a refusal (Charles, 12/11).
      if (ignored >= IGNORED_MESSAGES_FOR_REFUSAL) return { ok: true, run: refuse(run, event.at) };
      return { ok: true, run: { ...run, ignoredMessages: ignored } };
    }
    case 'session_cooled':
    case 'no_answer':
      return { ok: true, run: ended(run, 'stalled', event.at) };
    case 'human_took_over':
      return { ok: true, run: ended(run, 'closed_by_human', event.at) };
  }
}

function refuse(run: ScriptRun, at: Date): ScriptRun {
  return ended(
    withLast(run, (step) => ({ ...step, outcome: 'refused', at })),
    'refused',
    at,
  );
}

/** Whether every step of an open run is held (§ 7): sales frozen, a fragile fan, one not to write to, or care mode. */
export function scriptStepsHeld(flags: FanFlags, careMode: boolean): boolean {
  return careMode || flags.salesFrozen !== undefined || flags.fragile === true || flags.doNotContact === true;
}

/**
 * The scripts she may open with him (§ 6): of her moment on her clock, never played to him, every media validated,
 * nothing that touches her limits, and playable. The brain picks among these only.
 */
export function permittedScripts(
  catalogue: readonly CatalogueScript[],
  options: { readonly moment: DayPart; readonly playedScriptIds: ReadonlySet<string> },
): CatalogueScript[] {
  return catalogue.filter(
    (script) =>
      (script.moment === 'both' || script.moment === options.moment) &&
      !options.playedScriptIds.has(script.id) &&
      script.mediaValidated &&
      !script.touchesLimits &&
      catalogueScriptFaults(script).length === 0,
  );
}

export interface NextScriptStepInput {
  readonly now: Date;
  /** His latest run, open or ended, with its script; `null` when he never had one. */
  readonly latest: { readonly run: ScriptRun; readonly script: CatalogueScript } | null;
  readonly catalogue: readonly CatalogueScript[];
  /** Every script ever run with him, whatever became of it: never replayed (§ 1). */
  readonly playedScriptIds: ReadonlySet<string>;
  readonly moment: DayPart;
  /** His desire still at or above her opening score: the next step goes only in the same hot session (§ 12). */
  readonly hotSession: boolean;
  /** The brain's pick among the permitted scripts, by its id; `null` when it picked none. */
  readonly brainPick: string | null;
  /** The policy's context; `lastOfferAt` is her last paid step to him, whatever the run. */
  readonly offer: OfferContext;
  /** ADR 0088: nothing sold to a fan in distress. */
  readonly careMode: boolean;
}

type NoScriptReason = OfferBlock | 'held' | 'no_script' | 'no_pick' | 'cold_session';

export type ScriptStepDecision =
  | { readonly kind: 'none'; readonly reason: NoScriptReason }
  | { readonly kind: 'start'; readonly script: CatalogueScript; readonly step: CatalogueStep }
  | { readonly kind: 'send_step'; readonly step: CatalogueStep }
  | { readonly kind: 'wait'; readonly step: StepRecord }
  | { readonly kind: 'after_refusal'; readonly step: StepRecord }
  | { readonly kind: 'end'; readonly status: Exclude<ScriptRunStatus, 'open' | 'refused'> };

const later = (a: Date | null, b: Date | null): Date | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
};

/**
 * What she does with scripts on his message (§ 4): one closed decision, from the run, the policy and the moment. A run
 * that ended at this very message says so once (`end`, or `after_refusal` after a refusal); after that, a new script
 * may open, through the policy like any first one.
 */
export function nextScriptStep(input: NextScriptStepInput): ScriptStepDecision {
  const { latest } = input;
  if (latest === null) return startDecision(input);
  const { run, script } = latest;
  const status = run.status;
  if (status === 'open') return nextInOpenRun(input, run, script);
  if (run.endedAt?.getTime() === input.now.getTime()) {
    const last = current(run);
    if (status !== 'refused') return { kind: 'end', status };
    if (last !== undefined) return { kind: 'after_refusal', step: last };
  }
  return startDecision(input);
}

function nextInOpenRun(
  input: NextScriptStepInput,
  run: ScriptRun,
  script: CatalogueScript,
): ScriptStepDecision {
  const last = current(run);
  if (last !== undefined && (last.outcome === 'sent' || last.outcome === 'opened') && last.kind === 'paid') {
    return { kind: 'wait', step: last };
  }
  const next = nextStepOf(run, script);
  if (next === 'done') return { kind: 'end', status: 'bought_out' };
  if (next === undefined)
    return last === undefined ? { kind: 'none', reason: 'no_script' } : { kind: 'wait', step: last };
  if (!input.hotSession) return { kind: 'none', reason: 'cold_session' };
  if (scriptStepsHeld(input.offer.flags, input.careMode)) return { kind: 'none', reason: 'held' };
  if (next.kind === 'paid') {
    // The cooldown is between two scripts, not between two steps of the same one: the staircase climbs in one session.
    const decision = offerDecision({ ...input.offer, lastOfferAt: null });
    if (!decision.allowed) return { kind: 'none', reason: decision.reason };
  }
  return { kind: 'send_step', step: next };
}

function startDecision(input: NextScriptStepInput): ScriptStepDecision {
  if (input.careMode) return { kind: 'none', reason: 'held' };
  // The teasing opens the script: it waits for the cooldown like a paid step (Charles, 12/11).
  const decision = offerDecision({
    ...input.offer,
    lastOfferAt: later(input.offer.lastOfferAt, input.latest?.run.startedAt ?? null),
  });
  if (!decision.allowed) return { kind: 'none', reason: decision.reason };
  const permitted = permittedScripts(input.catalogue, {
    moment: input.moment,
    playedScriptIds: input.playedScriptIds,
  });
  if (permitted.length === 0) return { kind: 'none', reason: 'no_script' };
  // The brain picks the one that fits him; the code checks it is one of them, or nothing opens (fail closed).
  const script = permitted.find((candidate) => candidate.id === input.brainPick);
  if (script === undefined) return { kind: 'none', reason: 'no_pick' };
  const first = script.steps[0];
  if (first === undefined) return { kind: 'none', reason: 'no_script' };
  return { kind: 'start', script, step: first };
}
