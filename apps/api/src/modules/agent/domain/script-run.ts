import type {
  FanAvailabilityState,
  FanFlags,
  ScriptRunStatus,
  ScriptStart,
  ScriptStartBlock,
  ScriptStepKind,
  ScriptStepOutcome,
} from '@impera/contracts';

import { offerDecision, type OfferBlock, type OfferContext } from './policy';
import type { DayPart } from './situation';

/**
 * The run of a script with one fan (ADR 0098): the code keeps where he is, chooses the next step and its price, and
 * the voice only says them. Pure: a run and an event give the next run; a run and the moment give one closed decision.
 * What was already sent or bought to him is Reveal's to say (`getScriptHistory`, ADR 0018 § 5): a run holds only its
 * decision state, and is reconciled with that history before any decision.
 */

/** A step of a platform script as the agent reads it: offered (no price), paid, or a bridge (offered). */
interface PlatformScriptStepView {
  readonly kind: ScriptStepKind;
  /** The platform's price in minor units, for a paid step only; `null` for an offered step or a bridge. */
  readonly priceMinor: number | null;
  /** The agency's instruction for this step (its card, ADR 0064), when the catalogue has one: the voice follows it. */
  readonly instruction?: string;
  /** What the step sends, from its media's descriptions (ADR 0083): the voice describes nothing else. */
  readonly mediaSheet?: string;
  /** The vault media the step sends, by their platform ref: a media he already received rules out a script (§ 6). */
  readonly mediaRefs: readonly string[];
}

/**
 * A script of her catalogue (`listPlatformScripts()`, ADR 0018 § 5, P6-01), as the agent reads it: a step is known by
 * its index (`stepIndex`), what the platform sends by.
 */
export interface PlatformScriptView {
  readonly scriptRef: string;
  /** Jour or Nuit on her clock; `null`, either. */
  readonly moment: DayPart | null;
  /** What the run is about, for the brain to pick the one that fits him (ADR 0098 § 6). */
  readonly description: string;
  readonly steps: readonly PlatformScriptStepView[];
  /** Every media of every step described and validated (ADR 0083). */
  readonly mediaValidated: boolean;
  /** Its description, what the brain picks on, validated by the agency (ADR 0100): never picked on an unchecked one. */
  readonly descriptionValidated: boolean;
  /** Something in it touches a limit of her persona. */
  readonly touchesLimits: boolean;
}

type PlatformScriptFault =
  'no_step' | 'paid_without_price' | 'price_on_free_step' | 'bridge_at_edge' | 'starts_with_bridge';

/** What makes a script unplayable: such a script is never offered. Empty: it is playable. */
export function platformScriptFaults(script: PlatformScriptView): PlatformScriptFault[] {
  const faults: PlatformScriptFault[] = [];
  const { steps } = script;
  if (steps.length === 0) return ['no_step'];
  for (const step of steps) {
    if (step.kind === 'paid' && (step.priceMinor === null || step.priceMinor <= 0))
      faults.push('paid_without_price');
    if (step.kind !== 'paid' && step.priceMinor !== null) faults.push('price_on_free_step');
  }
  if (steps[0]?.kind === 'bridge') faults.push('starts_with_bridge');
  if (steps.at(-1)?.kind === 'bridge') faults.push('bridge_at_edge');
  return faults;
}

/**
 * What Reveal says was sent to him and what he bought (`getScriptHistory(fanRef)`, ADR 0018 § 5), per script and step
 * index: the only source of truth for « already sent ». Reveal gives `SentScriptStep { stepRef, purchased }`, the
 * step's id unique on the account, with neither its script nor when it went: the adapter finds both script and index
 * by `stepRef` in her catalogue (`purchased` → `boughtStepIndexes`), and the time of a send is the core's own journal.
 */
export interface ScriptHistoryView {
  readonly scripts: readonly {
    readonly scriptRef: string;
    readonly sentStepIndexes: readonly number[];
    readonly boughtStepIndexes: readonly number[];
  }[];
}

/**
 * Every media Reveal's history says he received, through her catalogue: each step sent or bought, by script and index,
 * gives the media of that step. A step the catalogue no longer holds (script gone, index past its end) gives nothing:
 * what it sent is unknown, and only its own script is ruled out, by `playedScriptRefs` (§ 6).
 */
function receivedMediaRefs(
  catalogue: readonly PlatformScriptView[],
  history: ScriptHistoryView,
): ReadonlySet<string> {
  const byRef = new Map(catalogue.map((script) => [script.scriptRef, script]));
  const received = new Set<string>();
  for (const entry of history.scripts) {
    const script = byRef.get(entry.scriptRef);
    if (script === undefined) continue;
    for (const index of [...entry.sentStepIndexes, ...entry.boughtStepIndexes]) {
      for (const ref of script.steps[index]?.mediaRefs ?? []) received.add(ref);
    }
  }
  return received;
}

/** Every script Reveal says was already sent to him, a step at least: never replayed (§ 1). */
export function playedScriptRefs(history: ScriptHistoryView): ReadonlySet<string> {
  return new Set(
    history.scripts
      .filter((script) => script.sentStepIndexes.length > 0 || script.boughtStepIndexes.length > 0)
      .map((script) => script.scriptRef),
  );
}

interface StepRecord {
  readonly stepIndex: number;
  readonly kind: ScriptStepKind;
  readonly outcome: ScriptStepOutcome;
  /** The price the decision was taken at; checked against the platform's at sending (`stepPriceCheck`). */
  readonly priceMinor: number | null;
  readonly sentAt: Date;
  /** When the outcome last changed. */
  readonly at: Date;
}

export interface ScriptRun {
  readonly scriptRef: string;
  readonly status: ScriptRunStatus;
  /** The steps sent, in order; the last one is the current step. */
  readonly steps: readonly StepRecord[];
  /** His messages in a row that ignore the paid step waiting: two make a refusal (Charles, 12/11). */
  readonly ignoredMessages: number;
  readonly startedAt: Date;
  readonly endedAt: Date | null;
}

export type ScriptRunEvent =
  | { readonly type: 'step_sent'; readonly stepIndex: number; readonly at: Date }
  | { readonly type: 'step_opened'; readonly stepIndex: number; readonly at: Date }
  | { readonly type: 'step_bought'; readonly stepIndex: number; readonly at: Date }
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

type ScriptRunResult =
  { readonly ok: true; readonly run: ScriptRun } | { readonly ok: false; readonly fault: ScriptRunFault };

const IGNORED_MESSAGES_FOR_REFUSAL = 2;

/** A new run, its first step not sent yet. */
export function openScriptRun(scriptRef: string, at: Date): ScriptRun {
  return { scriptRef, status: 'open', steps: [], ignoredMessages: 0, startedAt: at, endedAt: null };
}

const current = (run: ScriptRun): StepRecord | undefined => run.steps.at(-1);

/** A paid step sent or opened, neither bought nor refused: what his messages are counted against. */
export const paidWaiting = (run: ScriptRun): StepRecord | undefined => {
  const step = current(run);
  return step?.kind === 'paid' && (step.outcome === 'sent' || step.outcome === 'opened') ? step : undefined;
};

/** The index of the step that comes after what was sent, if the last one lets it go (§ 3, § 8). */
function nextStepIndex(run: ScriptRun, script: PlatformScriptView): number | 'done' | undefined {
  const last = current(run);
  if (last === undefined) return 0;
  // A paid step goes on only once bought; an offered step or a bridge once sent.
  if (last.outcome === 'refused') return undefined;
  if (last.kind === 'paid' && last.outcome !== 'bought') return undefined;
  return last.stepIndex + 1 < script.steps.length ? last.stepIndex + 1 : 'done';
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
  script: PlatformScriptView,
  event: ScriptRunEvent,
): ScriptRunResult {
  if (run.status !== 'open') return { ok: false, fault: 'run_closed' };
  switch (event.type) {
    case 'step_sent': {
      const next = nextStepIndex(run, script);
      const step = typeof next === 'number' ? script.steps[next] : undefined;
      if (step === undefined || next !== event.stepIndex) return { ok: false, fault: 'not_next_step' };
      const record: StepRecord = {
        stepIndex: event.stepIndex,
        kind: step.kind,
        outcome: 'sent',
        priceMinor: step.priceMinor,
        sentAt: event.at,
        at: event.at,
      };
      return { ok: true, run: { ...run, steps: [...run.steps, record], ignoredMessages: 0 } };
    }
    case 'step_opened': {
      const last = current(run);
      if (last?.stepIndex !== event.stepIndex) return { ok: false, fault: 'unknown_step' };
      if (last.outcome !== 'sent') return { ok: true, run };
      return { ok: true, run: withLast(run, (step) => ({ ...step, outcome: 'opened', at: event.at })) };
    }
    case 'step_bought': {
      const last = current(run);
      if (last?.stepIndex !== event.stepIndex) return { ok: false, fault: 'unknown_step' };
      if (last.kind !== 'paid') return { ok: false, fault: 'not_paid' };
      if (last.outcome === 'bought') return { ok: true, run };
      const bought = withLast(run, (step) => ({ ...step, outcome: 'bought', at: event.at }));
      const after = { ...bought, ignoredMessages: 0 };
      return {
        ok: true,
        run: nextStepIndex(after, script) === 'done' ? ended(after, 'bought_out', event.at) : after,
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

/**
 * The run as Reveal's history says it is, before any decision (ADR 0018 § 5): where they disagree on what was sent or
 * bought, Reveal wins. A step Reveal says was sent and the run missed joins it (sent at `at`); one the run thinks sent
 * and Reveal does not know leaves it, so that it is decided again and sent under the same idempotency key; a step
 * Reveal says bought is bought. An ended run is left as it is: its refusal, stall or human's hand are its own, which
 * Reveal does not know, and what was sent to him is read from the history itself (`playedScriptRefs`).
 */
export function reconcileScriptRun(
  run: ScriptRun,
  script: PlatformScriptView,
  history: ScriptHistoryView,
  at: Date,
): ScriptRun {
  if (run.status !== 'open') return run;
  const seen = history.scripts.find((entry) => entry.scriptRef === run.scriptRef);
  const bought = new Set(seen?.boughtStepIndexes ?? []);
  const sent = new Set([...(seen?.sentStepIndexes ?? []), ...bought]);
  const lastSent = Math.max(-1, ...[...sent].filter((index) => index < script.steps.length));
  const byIndex = new Map(run.steps.map((step) => [step.stepIndex, step]));
  const steps: StepRecord[] = [];
  for (let index = 0; index <= lastSent; index += 1) {
    const step = script.steps[index];
    if (step === undefined) break;
    const known = byIndex.get(index);
    const outcome: ScriptStepOutcome =
      bought.has(index) && step.kind === 'paid' ? 'bought' : (known?.outcome ?? 'sent');
    steps.push({
      stepIndex: index,
      kind: step.kind,
      outcome,
      priceMinor: known?.priceMinor ?? step.priceMinor,
      sentAt: known?.sentAt ?? at,
      at: known?.outcome === outcome ? known.at : at,
    });
  }
  const reconciled = { ...run, steps };
  if (nextStepIndex(reconciled, script) === 'done' && current(reconciled)?.outcome === 'bought') {
    return ended(reconciled, 'bought_out', at);
  }
  return reconciled;
}

/** Whether every step of an open run is held (§ 7): sales frozen, a fragile fan, one not to write to, or care mode. */
export function scriptStepsHeld(flags: FanFlags, careMode: boolean): boolean {
  return careMode || flags.salesFrozen !== undefined || flags.fragile === true || flags.doNotContact === true;
}

/**
 * The scripts she may open with him (§ 6): of her moment on her clock, never sent to him by Reveal's history, no media
 * he already received, every media and the description validated, nothing that touches her limits, and playable. The
 * brain picks among these only, in the catalogue's order.
 */
export function permittedScripts(
  catalogue: readonly PlatformScriptView[],
  options: { readonly moment: DayPart; readonly history: ScriptHistoryView },
): PlatformScriptView[] {
  const played = playedScriptRefs(options.history);
  const received = receivedMediaRefs(catalogue, options.history);
  return catalogue.filter(
    (script) =>
      (script.moment === null || script.moment === options.moment) &&
      !played.has(script.scriptRef) &&
      !script.steps.some((step) => step.mediaRefs.some((ref) => received.has(ref))) &&
      script.mediaValidated &&
      script.descriptionValidated &&
      !script.touchesLimits &&
      platformScriptFaults(script).length === 0,
  );
}

/** What goes to `sendScriptStep(conversationRef, scriptRef, stepIndex, key)`, with the price it was decided at. */
export interface ScriptStepToSend {
  readonly scriptRef: string;
  readonly stepIndex: number;
  readonly kind: ScriptStepKind;
  readonly priceMinor: number | null;
  /** One key per conversation, script and step: a replay never sends twice (ADR 0018 § 5). */
  readonly idempotencyKey: string;
}

/**
 * The price decided against the platform's at sending: a step whose price changed on Reveal is never sent, it is an
 * alert for the team (ADR 0098 § 5).
 */
export function stepPriceCheck(
  decided: Pick<ScriptStepToSend, 'priceMinor'>,
  platform: Pick<PlatformScriptStepView, 'priceMinor'>,
): 'send' | 'price_mismatch' {
  return decided.priceMinor === platform.priceMinor ? 'send' : 'price_mismatch';
}

export interface NextScriptStepInput {
  readonly now: Date;
  /** The conversation on the platform: the idempotency key of a step names it. */
  readonly conversationRef: string;
  /** His latest run, open or ended, already reconciled with `history`, and its script; `null` when he never had one. */
  readonly latest: { readonly run: ScriptRun; readonly script: PlatformScriptView } | null;
  readonly catalogue: readonly PlatformScriptView[];
  /** Reveal's history of his scripts; `null` when it could not be read: then nothing is sold (ADR 0018 § 5). */
  readonly history: ScriptHistoryView | null;
  readonly moment: DayPart;
  /** His desire still at or above her opening score: the next step goes only in the same hot session (§ 12). */
  readonly hotSession: boolean;
  /** The brain's pick among the permitted scripts, by its ref; `null` when it picked none. */
  readonly brainPick: string | null;
  /** The policy's context; `lastOfferAt` is her last paid step to him, whatever the run. */
  readonly offer: OfferContext;
  /** ADR 0088: nothing sold to a fan in distress. */
  readonly careMode: boolean;
  /**
   * The gate before the first teaser (ADR 0103 § 11, `scriptStartGate`): closed, no script starts and the decision
   * waits on what is missing. Absent, as open: the evals and tests that predate it.
   */
  readonly startGate?: ScriptStart;
  /** His availability as code holds it: « non » pauses an open run, no step and no refusal counted (§ 12). */
  readonly availability?: FanAvailabilityState;
}

type NoScriptReason =
  OfferBlock | 'held' | 'no_history' | 'no_script' | 'no_pick' | 'cold_session' | 'price_mismatch';

export type ScriptStepDecision =
  | { readonly kind: 'none'; readonly reason: NoScriptReason }
  | { readonly kind: 'start'; readonly script: PlatformScriptView; readonly step: ScriptStepToSend }
  | { readonly kind: 'send_step'; readonly step: ScriptStepToSend }
  | { readonly kind: 'wait'; readonly step: StepRecord }
  /** No script may start yet, or an open one pauses (ADR 0103 § 11-12): the first condition missing. */
  | { readonly kind: 'wait'; readonly reason: ScriptStartBlock }
  | { readonly kind: 'after_refusal'; readonly step: StepRecord }
  | { readonly kind: 'end'; readonly status: Exclude<ScriptRunStatus, 'open' | 'refused'> };

const later = (a: Date | null, b: Date | null): Date | null => {
  if (a === null) return b;
  if (b === null) return a;
  return a.getTime() >= b.getTime() ? a : b;
};

function toSend(
  conversationRef: string,
  script: PlatformScriptView,
  stepIndex: number,
): ScriptStepToSend | null {
  const step = script.steps[stepIndex];
  if (step === undefined) return null;
  return {
    scriptRef: script.scriptRef,
    stepIndex,
    kind: step.kind,
    priceMinor: step.priceMinor,
    idempotencyKey: `script-step:${conversationRef}:${script.scriptRef}:${String(stepIndex)}`,
  };
}

/**
 * What she does with scripts on his message (§ 4): one closed decision, from the run, the policy and the moment. A run
 * that ended at this very message says so once (`end`, or `after_refusal` after a refusal); after that, a new script
 * may open, through the policy like any first one. Without Reveal's history, nothing is sold.
 */
export function nextScriptStep(input: NextScriptStepInput): ScriptStepDecision {
  const { history, latest } = input;
  if (history === null) return { kind: 'none', reason: 'no_history' };
  if (latest === null) return startDecision(input, history);
  const { run, script } = latest;
  const status = run.status;
  if (status === 'open') return nextInOpenRun(input, run, script);
  if (run.endedAt?.getTime() === input.now.getTime()) {
    const last = current(run);
    if (status !== 'refused') return { kind: 'end', status };
    if (last !== undefined) return { kind: 'after_refusal', step: last };
  }
  return startDecision(input, history);
}

function nextInOpenRun(
  input: NextScriptStepInput,
  run: ScriptRun,
  script: PlatformScriptView,
): ScriptStepDecision {
  const last = current(run);
  if (last !== undefined && paidWaiting(run) !== undefined) return { kind: 'wait', step: last };
  const next = nextStepIndex(run, script);
  if (next === 'done') return { kind: 'end', status: 'bought_out' };
  if (next === undefined) return { kind: 'none', reason: 'no_script' };
  // He said someone is there, or he must leave: the run pauses, nothing goes and nothing is held against him.
  if (input.availability === 'no') return { kind: 'wait', reason: 'availability_unconfirmed' };
  const step = toSend(input.conversationRef, script, next);
  if (step === null) return { kind: 'none', reason: 'no_script' };
  if (!input.hotSession) return { kind: 'none', reason: 'cold_session' };
  if (scriptStepsHeld(input.offer.flags, input.careMode)) return { kind: 'none', reason: 'held' };
  if (step.kind === 'paid') {
    // The cooldown is between two scripts, not between two steps of the same one: the staircase climbs in one session.
    const decision = offerDecision({ ...input.offer, lastOfferAt: null });
    if (!decision.allowed) return { kind: 'none', reason: decision.reason };
  }
  return { kind: 'send_step', step };
}

function startDecision(input: NextScriptStepInput, history: ScriptHistoryView): ScriptStepDecision {
  if (input.careMode) return { kind: 'none', reason: 'held' };
  // The teasing opens the script: it waits for the cooldown like a paid step (Charles, 12/11).
  const decision = offerDecision({
    ...input.offer,
    lastOfferAt: later(input.offer.lastOfferAt, input.latest?.run.startedAt ?? null),
  });
  if (!decision.allowed && decision.reason !== 'low_desire') return { kind: 'none', reason: decision.reason };
  // Hot, sexualizing and free, or no teaser: a teaser sent spends the script, which never plays again (Charles, 13/11).
  const gate = input.startGate;
  // Closed without a reason never happens; it stays closed if it did (fail closed).
  if (gate !== undefined && !gate.open) {
    return { kind: 'wait', reason: gate.missing[0] ?? 'availability_unconfirmed' };
  }
  if (!decision.allowed) return { kind: 'none', reason: decision.reason };
  const permitted = permittedScripts(input.catalogue, { moment: input.moment, history });
  if (permitted.length === 0) return { kind: 'none', reason: 'no_script' };
  // The brain picks the one that fits him; the code checks it is one of them, or nothing opens (fail closed).
  const script = permitted.find((candidate) => candidate.scriptRef === input.brainPick);
  if (script === undefined) return { kind: 'none', reason: 'no_pick' };
  const step = toSend(input.conversationRef, script, 0);
  if (step === null) return { kind: 'none', reason: 'no_script' };
  return { kind: 'start', script, step };
}
