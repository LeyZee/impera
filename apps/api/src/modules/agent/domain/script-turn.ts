import {
  applyScriptRunEvent,
  nextScriptStep,
  openScriptRun,
  paidWaiting,
  reconcileScriptRun,
  stepPriceCheck,
  type NextScriptStepInput,
  type PlatformScriptView,
  type ScriptRun,
  type ScriptStepDecision,
} from './script-run';

/**
 * One message of his, for scripts (ADR 0098 § 4): his stored run reconciled with Reveal's history, moved by what the
 * brain read in his message, then one closed decision, applied to the run. Pure: the caller writes the runs and the
 * journal, and the voice says the step decided. Nothing is sent from here: a step decided is draft content (P2-03 sends).
 */

/** What his last message does with the step waiting for him, as the brain read it (`Brief.scriptReply`). */
type ScriptReply = 'refused' | 'answers_step' | 'claims_bought';

/** An event the turn journals for a run, in order (§ 2); the run's id is the caller's. */
export type ScriptJournalEvent =
  | { readonly type: 'script_started' }
  | {
      readonly type: 'script_step_sent' | 'script_step_opened' | 'script_step_refused';
      readonly stepIndex: number;
    }
  | { readonly type: 'script_ended' };

export interface ScriptTurnInput extends Omit<NextScriptStepInput, 'latest'> {
  /** His latest run as stored, open or ended; `null` when he never had one. */
  readonly latest: ScriptRun | null;
  /** What his message does with the step waiting, as the brain read it; `null`, nothing about it. */
  readonly reply: ScriptReply | null;
  /** False on a second pass over the same message (a wait, a replay): it was already counted against the step. */
  readonly countsHisMessage: boolean;
  /**
   * False when something else answers this message (a trap, the cursor steering him back, a custom order, a brain
   * that failed): the run still follows his message and Reveal, but no step goes.
   */
  readonly mayAct: boolean;
}

/** A run that changed at this message, with the events that say how. */
interface RunChange {
  readonly run: ScriptRun;
  readonly events: readonly ScriptJournalEvent[];
}

export interface ScriptTurn {
  readonly decision: ScriptStepDecision;
  /** The script of the step decided (`start`, `send_step`): the voice's block reads its step. */
  readonly script: PlatformScriptView | null;
  /** His stored run, when this message moved it (Reveal's history, his reply, the step decided). */
  readonly moved: RunChange | null;
  /**
   * His stored run moved by Reveal's history and his message only, before any step: what is kept when no draft goes
   * out (a guard blocked it, a human answers), since a step not written was not sent.
   */
  readonly followed: RunChange | null;
  /** A run opened at this message (`start`). */
  readonly opened: RunChange | null;
  /**
   * A step whose price on the catalogue differs from the one decided: it does not go, the team is alerted (§ 5). The
   * step waiting for him is checked too: he would buy at the catalogue's price, not the one she said.
   */
  readonly priceMismatch: { readonly scriptRef: string; readonly stepIndex: number } | null;
}

/** A script no longer in her catalogue: its run keeps its state, and nothing of it can go out. */
const retired = (scriptRef: string): PlatformScriptView => ({
  scriptRef,
  moment: null,
  description: '',
  steps: [],
  mediaValidated: false,
  descriptionValidated: false,
  touchesLimits: false,
});

const stamp = (run: ScriptRun): string =>
  JSON.stringify(run, (_, value: unknown) => (value instanceof Date ? value.toISOString() : value));

/** The events that take `before` to `after` (§ 2): a bought step is the platform's sale, journaled by its connector. */
function journalOf(before: ScriptRun | null, after: ScriptRun): ScriptJournalEvent[] {
  const events: ScriptJournalEvent[] = before === null ? [{ type: 'script_started' }] : [];
  const known = new Map((before?.steps ?? []).map((step) => [step.stepIndex, step.outcome]));
  for (const step of after.steps) {
    const was = known.get(step.stepIndex);
    if (was === undefined) events.push({ type: 'script_step_sent', stepIndex: step.stepIndex });
    if (was === step.outcome) continue;
    if (step.outcome === 'opened') events.push({ type: 'script_step_opened', stepIndex: step.stepIndex });
    if (step.outcome === 'refused') events.push({ type: 'script_step_refused', stepIndex: step.stepIndex });
  }
  if (after.status !== 'open' && before?.status !== after.status) events.push({ type: 'script_ended' });
  return events;
}

/** His message against the step waiting: a clear no, an answer to it, or a message about something else (§ 9). */
function afterHisMessage(
  run: ScriptRun,
  script: PlatformScriptView,
  reply: ScriptReply | null,
  at: Date,
): ScriptRun {
  if (reply === 'refused') {
    const refused = applyScriptRunEvent(run, script, { type: 'refused', at });
    if (refused.ok) return refused.run;
  }
  // « Je l'ai pris » is an answer to the step, never a purchase: only Reveal says what he bought (ADR 0018 § 5).
  const moved = applyScriptRunEvent(run, script, { type: 'fan_message', aboutTheStep: reply !== null, at });
  return moved.ok ? moved.run : run;
}

const noStep = (decision: ScriptStepDecision): boolean =>
  decision.kind !== 'start' && decision.kind !== 'send_step';

export function scriptTurn(input: ScriptTurnInput): ScriptTurn {
  const { history, latest: stored, now } = input;
  const nothing = { script: null, moved: null, followed: null, opened: null, priceMismatch: null };
  // Without Reveal's history nothing moves and nothing sells (fail closed).
  if (history === null) return { ...nothing, decision: { kind: 'none', reason: 'no_history' } };
  const listed = stored === null ? undefined : input.catalogue.find((s) => s.scriptRef === stored.scriptRef);
  if (stored?.status === 'open' && listed === undefined) {
    return { ...nothing, decision: { kind: 'none', reason: 'no_script' } };
  }
  const storedScript = stored === null ? null : (listed ?? retired(stored.scriptRef));
  let run = stored;
  if (run !== null && storedScript !== null && run.status === 'open') {
    run = reconcileScriptRun(run, storedScript, history, now);
    // Paused while he is not free (ADR 0103 § 12): his message is neither an answer to the step nor a refusal.
    if (input.countsHisMessage && input.availability !== 'no')
      run = afterHisMessage(run, storedScript, input.reply, now);
  }
  const latest = run === null || storedScript === null ? null : { run, script: storedScript };
  const decided = nextScriptStep({ ...input, latest });
  const decision: ScriptStepDecision =
    !input.mayAct && !noStep(decided) ? { kind: 'none', reason: 'held' } : decided;

  let opened: RunChange | null = null;
  let script: PlatformScriptView | null = null;
  let priceMismatch: ScriptTurn['priceMismatch'] = null;
  let current = run;
  let final = decision;
  if (decision.kind === 'start' || (decision.kind === 'send_step' && latest !== null)) {
    const target = decision.kind === 'start' ? decision.script : (latest?.script ?? null);
    const base = decision.kind === 'start' ? openScriptRun(decision.step.scriptRef, now) : current;
    const platformStep = target?.steps[decision.step.stepIndex];
    if (target === null || base === null || platformStep === undefined) {
      final = { kind: 'none', reason: 'no_script' };
    } else if (stepPriceCheck(decision.step, platformStep) === 'price_mismatch') {
      priceMismatch = { scriptRef: target.scriptRef, stepIndex: decision.step.stepIndex };
      final = { kind: 'none', reason: 'price_mismatch' };
    } else {
      const sent = applyScriptRunEvent(base, target, {
        type: 'step_sent',
        stepIndex: decision.step.stepIndex,
        at: now,
      });
      if (!sent.ok) {
        final = { kind: 'none', reason: 'no_script' };
      } else if (decision.kind === 'start') {
        opened = { run: sent.run, events: journalOf(null, sent.run) };
        script = target;
      } else {
        current = sent.run;
        script = target;
      }
    }
  }
  if (final.kind === 'wait' && storedScript !== null && current !== null) {
    const waiting = paidWaiting(current);
    const platformStep = waiting === undefined ? undefined : storedScript.steps[waiting.stepIndex];
    if (
      waiting !== undefined &&
      platformStep !== undefined &&
      stepPriceCheck(waiting, platformStep) !== 'send'
    ) {
      priceMismatch = { scriptRef: storedScript.scriptRef, stepIndex: waiting.stepIndex };
    }
  }
  const changed = (after: ScriptRun | null): RunChange | null =>
    stored === null || after === null || stamp(stored) === stamp(after)
      ? null
      : { run: after, events: journalOf(stored, after) };
  return { decision: final, script, moved: changed(current), followed: changed(run), opened, priceMismatch };
}
