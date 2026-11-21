import type { ConversationTurn } from '@impera/llm';

import type { ComposedTurn, FanAvailabilityRecord, ScriptsInput } from '../../modules/agent/index';

const MINUTE_MS = 60_000;

/**
 * A whole conversation replayed without a keyboard (passes de test du 20/11): what the next message of his reads, as
 * the database would hold it after her last answer. Nothing is sent; the fan's lines are written in advance.
 */
export interface DialogueState {
  readonly now: Date;
  readonly history: readonly ConversationTurn[];
  /** His desire score as stored after her last answer (P3-12). */
  readonly desire: number;
  readonly availability: FanAvailabilityRecord;
  readonly scripts: ScriptsInput | undefined;
  /** Absent: she never answered his asking to meet her. */
  readonly meeting?: MeetingSeen;
}

type History = NonNullable<ScriptsInput['history']>;
type MeetingAnswer = NonNullable<ComposedTurn['meetingAnswer']>;
type MeetingReason = Extract<MeetingAnswer, { kind: 'reason' }>['reason'];

/** What she already answered him about meeting her, as the journal would keep it (Charles 21/11). */
export interface MeetingSeen {
  readonly given: readonly MeetingReason[];
  readonly teased: boolean;
}
type Run = NonNullable<ScriptsInput['latest']>;

/** What one turn of the engine left, as the respond job keeps it. */
export interface TurnLeft {
  /** The history the engine read: the state's, then his new messages. */
  readonly heard: readonly ConversationTurn[];
  /** Her bubbles that go out; none when a human takes over or a guard held the draft. */
  readonly bubbles: readonly string[];
  readonly desire: ComposedTurn['desireRead'];
  readonly availability: ComposedTurn['availability'];
  readonly scripts: ComposedTurn['scripts'];
  readonly meetingAnswer?: MeetingAnswer;
}

/** A reason she gave, or her one tease, kept once her answer went out: never given twice. */
function meetingAfter(
  seen: MeetingSeen | undefined,
  answer: MeetingAnswer | undefined,
): MeetingSeen | undefined {
  if (answer === undefined) return seen;
  const before = seen ?? { given: [], teased: false };
  if (answer.kind === 'reason') return { ...before, given: [...before.given, answer.reason] };
  return answer.kind === 'tease' ? { ...before, teased: true } : seen;
}

/** Reveal's history after a step went out: that step sent, once. */
function withSent(history: History, scriptRef: string, index: number): History {
  const known = history.scripts.some((entry) => entry.scriptRef === scriptRef);
  const scripts = known
    ? history.scripts.map((entry) =>
        entry.scriptRef !== scriptRef || entry.sentStepIndexes.includes(index)
          ? entry
          : { ...entry, sentStepIndexes: [...entry.sentStepIndexes, index] },
      )
    : [...history.scripts, { scriptRef, sentStepIndexes: [index], boughtStepIndexes: [] }];
  return { scripts };
}

/**
 * The state after her answer: her bubbles in the history at `now`, his score and availability as stored, his run as
 * the job keeps it (opened or moved when her draft goes out, followed only when nothing does), and Reveal's history with
 * the step
 * she sent.
 */
export function afterTurn(state: DialogueState, left: TurnLeft): DialogueState {
  const sent = left.bubbles.length > 0;
  const history = [
    ...left.heard,
    ...left.bubbles.map((text): ConversationTurn => ({ from: 'creator', text, at: state.now })),
  ];
  let scripts = state.scripts;
  const turn = left.scripts;
  if (scripts !== undefined && turn !== undefined) {
    // A run opened at this message is his latest; else the one moved, or only followed when nothing went out.
    const kept = sent ? (turn.opened ?? turn.moved) : turn.followed;
    const decision = turn.decision;
    const stepSent = sent && (decision.kind === 'start' || decision.kind === 'send_step');
    scripts = {
      ...scripts,
      latest: kept?.run ?? scripts.latest,
      history:
        stepSent && scripts.history !== null
          ? withSent(scripts.history, decision.step.scriptRef, decision.step.stepIndex)
          : scripts.history,
      // A new message of his is counted against the step waiting.
      countsHisMessage: true,
    };
  }
  const meeting = sent ? meetingAfter(state.meeting, left.meetingAnswer) : state.meeting;
  return {
    ...state,
    history,
    desire: left.desire?.score ?? state.desire,
    availability: left.availability?.record ?? state.availability,
    scripts,
    ...(meeting !== undefined && { meeting }),
  };
}

/** What happens on Reveal between two of his messages; the next message reads it as Reveal's history. */
export type DialogueEvent = 'buys_step';

/** He bought the last paid step she sent him: Reveal says so, never his word (ADR 0098 § 9). */
function boughtLastPaid(scripts: ScriptsInput): ScriptsInput {
  const run: Run | null = scripts.latest;
  const step = run?.steps.findLast((s) => s.kind === 'paid' && s.outcome !== 'bought');
  if (run === null || step === undefined || scripts.history === null) return scripts;
  return {
    ...scripts,
    history: {
      scripts: scripts.history.scripts.map((entry) =>
        entry.scriptRef !== run.scriptRef || entry.boughtStepIndexes.includes(step.stepIndex)
          ? entry
          : { ...entry, boughtStepIndexes: [...entry.boughtStepIndexes, step.stepIndex] },
      ),
    },
  };
}

/** The state when his next message comes: time passed, and what Reveal says happened meanwhile. */
export function beforeTurn(
  state: DialogueState,
  afterMinutes: number,
  event: DialogueEvent | undefined,
): DialogueState {
  const now = new Date(state.now.getTime() + afterMinutes * MINUTE_MS);
  const scripts =
    event === 'buys_step' && state.scripts !== undefined ? boughtLastPaid(state.scripts) : state.scripts;
  return { ...state, now, scripts };
}
