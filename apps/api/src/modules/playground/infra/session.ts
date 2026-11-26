import {
  desireBandOf,
  type DesireBand,
  type DesireSignal,
  type MediaDescription,
  type ObjectionReplies,
} from '@impera/contracts';
import type { Brief, ConversationTurn, LlmFailure, LlmGateway, VoiceInput } from '@impera/llm';

import {
  asSent,
  checkVoiceOutput,
  composeTurn,
  followUpDecision,
  guardContextOf,
  withoutOrders,
  isBlocked,
  type GuardSettings,
  type GuardViolation,
  type PersonaLanguages,
  type VoiceExample,
  type FollowUpDecision,
  measureDesire,
  holdDecision,
  safetySigns,
  type HoldDecision,
  type DesireMeasure,
  type DesireState,
  type FanAvailabilityRecord,
  type OfferInput,
  type OfferLimits,
  type RatedMoment,
  type ScriptStart,
  type SexualizationLimits,
  type Situation,
  type TrapAssessment,
  applyScriptRunEvent,
  paidWaiting,
  type AgentScriptView,
  type ScriptHistoryView,
  type ScriptRun,
} from '../../agent/index';
import { kycSlotWords } from '../domain/labels';
import { completeMedia } from '../domain/media';

import type { Catalogue, CatalogueUnavailable, PlaygroundScript, ShownMedia } from './catalogue';
import { TRIAL_CATALOGUE } from './trial-scripts';

export interface PlaygroundTurn {
  /** Safety flags on his media: a human would take over, nothing is written. */
  readonly handoff?: readonly string[];
  readonly trap?: TrapAssessment;
  readonly brief?: Brief;
  readonly briefFailure?: string;
  readonly bubbles: readonly string[];
  readonly voiceFailure?: string;
  readonly violations: readonly GuardViolation[];
  readonly isBlocked: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly model?: string;
  readonly isFallback: boolean;
  /** His desire score read on this message, moved or not (P3-12): what the cursor and the policy read. */
  readonly desire?: PlaygroundDesireReading;
  /** What the cursor decided on going sexual (P3-09); absent when the brain did not read the moment. */
  readonly cursor?: { readonly kind: string; readonly reason?: string };
  /** The brain wanted to offer and the policy said no: the code of why. */
  readonly offerRefused?: string;
  /**
   * The brain read a risk, or he asked her to wait: what production does instead of a plain answer (agent/domain/hold.ts,
   * AGE-01). A handoff or a wait writes nothing; care writes the care brief, a human validating every word (ADR 0088).
   */
  readonly hold?: Exclude<HoldDecision, { readonly kind: 'answer' }>;
}

/** His desire score as one message of his left it, with what moved it (P3-12). */
export interface PlaygroundDesireReading {
  readonly before: number | null;
  readonly score: number;
  readonly band: DesireBand;
  readonly signals: readonly DesireSignal[];
  readonly weightsVersion: string;
  /** His availability and the gate before the first teaser at this message (ADR 0103 § 14). */
  readonly availability?: PlaygroundAvailabilityReading;
}

/** His availability as this message of his left it, the gate, and whether she asked him this time. */
export interface PlaygroundAvailabilityReading {
  readonly record: FanAvailabilityRecord;
  readonly gate: ScriptStart;
  readonly asked: boolean;
}

/** She asked him whether he is free in her answer to this message: `askedAt` set, and not the one he had before. */
function askedNow(before: FanAvailabilityRecord | null, after: FanAvailabilityRecord): boolean {
  return after.askedAt !== null && after.askedAt.getTime() !== before?.askedAt?.getTime();
}

/** The last answer and what it was written from: what a rating records, and what a comparison replays. */
interface PlaygroundExchange {
  readonly fanMessage: string;
  readonly turn: PlaygroundTurn;
  readonly moment: RatedMoment;
  readonly voiceInput?: VoiceInput;
}

/** A follow-up asked with /relance: written, or why not (not due yet, her quiet hours, none left). */
export type PlaygroundFollowUp =
  | { readonly kind: 'written'; readonly step: number; readonly turn: PlaygroundTurn }
  | { readonly kind: 'not_due'; readonly step: number; readonly dueAt: Date }
  | { readonly kind: 'nothing_to_follow_up' }
  | Exclude<FollowUpDecision, { readonly kind: 'write' }>;

interface VoiceComparison {
  readonly bubbles: readonly string[];
  readonly violations: readonly GuardViolation[];
  readonly isBlocked: boolean;
  readonly model?: string;
  readonly costUsd: number;
  readonly failure?: string;
}

/** A step of a script on the media she sent with it, and what became of it (ADR 0103 § 16). */
interface TrialStep {
  /** Her own script, or a trial one. */
  readonly source: Catalogue['source'];
  readonly scriptRef: string;
  readonly stepIndex: number;
  readonly kind: 'free' | 'paid' | 'bridge';
  readonly priceCents: number | null;
  readonly state: 'offered' | 'waiting' | 'bought' | 'refused' | 'closed';
}

/** What « Payer (fictif) » or « Refuser » did: nothing when no paid step waits for him. */
type TrialStepAction = 'done' | 'nothing_waiting' | 'sales_frozen';

export interface PlaygroundSession {
  /** His message, with the descriptions of the media he sends with it. */
  handleFanMessage(text: string, media?: readonly MediaDescription[]): Promise<PlaygroundTurn>;
  /** She sends one of her media (a teaser, or a locked paid one he can ask about). */
  sendCreatorMedia(description: MediaDescription, isLocked: boolean): void;
  /** Her answer as the team rewrote it: the conversation goes on from the corrected version. */
  replaceLastAnswer(text: string): void;
  /** His desire score after each of his messages, by message (from 0); `undefined` where the brain read nothing. */
  readonly desireTrail: readonly (PlaygroundDesireReading | undefined)[];
  /** Back to just before his n-th message (from 1); returns that message to send again, on a new branch. */
  branchAt(fanMessageNumber: number): { text: string; media: MediaDescription[] } | undefined;
  /** The same moment written by another voice model, side by side; the conversation does not change. */
  compareVoice(gateway: LlmGateway): Promise<VoiceComparison | undefined>;
  setSituation(patch: Partial<Situation>): void;
  /** The simulated clock: tests follow-ups, day and night, the sexualisation delay. */
  advance(ms: number): void;
  /** Her next follow-up on his silence, as `conversation.follow_up` would ask for it at the simulated time (P3-10). */
  followUp(): Promise<PlaygroundFollowUp>;
  setFanNotes(notes: readonly string[]): void;
  /** His age as already confirmed before the conversation (a simulated fan she knows), or unknown again. */
  confirmAge(at: Date | null): void;
  reset(): void;
  /**
   * He buys the paid step waiting, fictively (ADR 0103 § 16): the media unlocks, its price joins what he spent, and the
   * script may go on at his next message. Nothing reaches Reveal, the sales or the figures.
   */
  buyStep(): TrialStepAction;
  /** He refuses the paid step waiting: an explicit refusal, as the brain reads a clear no. */
  refuseStep(): TrialStepAction;
  /** The script under way or last played, with its script; `null` before the first. */
  readonly scriptRun: {
    readonly run: ScriptRun;
    readonly script: AgentScriptView;
    readonly name: string;
    readonly source: Catalogue['source'];
  } | null;
  /** What he paid in fictive purchases since the start, or the reset. */
  readonly fictiveSpentCents: number;
  /**
   * A possible minor or his distress froze his sales in this conversation (agent/domain/hold.ts): « Payer (fictif) » is
   * refused, so the playground never shows a sale production would not make. Lifted by a reset or a branch before it.
   */
  readonly salesFrozen: boolean;
  /** The step of a script a media of hers carries, with what became of it. */
  trialStepOf(turn: ConversationTurn): TrialStep | undefined;
  /** Each media of a step she sent: its ref in her vault (or the trial's), and whether it is the bundle's teaser. */
  stepMediaOf(
    turn: ConversationTurn,
  ): readonly { readonly ref: string; readonly teaser: boolean }[] | undefined;
  /** Where her scripts come from now, and why none of hers can be played. */
  readonly catalogue: {
    readonly source: Catalogue['source'];
    readonly unavailable: CatalogueUnavailable | null;
  };
  /** Reads her catalogue again, as each of his messages does: the screen says at once whether she has one to sell. */
  readCatalogue(): Promise<void>;
  readonly history: readonly ConversationTurn[];
  readonly fanNotes: readonly string[];
  readonly situation: Situation;
  readonly lastExchange: PlaygroundExchange | undefined;
  /** While an answer is being written: the brain's reading of his message once it has read it, before the voice. */
  readonly reading: NonNullable<PlaygroundTurn['brief']> | undefined;
}

export interface PlaygroundDeps {
  readonly gateway: LlmGateway;
  readonly creatorName: string;
  readonly personaSheet: string;
  /** Her bio on her platform profile, as real fans read it (ADR 0154 § 7); absent: the invented persona has none. */
  readonly profileBio?: string | null;
  readonly guardSettings: GuardSettings;
  /** False: her answer is shown as one message, as the fan would get it (`behavior.split_messages`). */
  readonly splitMessages?: boolean;
  /**
   * Her bank's examples her hard guards let through, newest first (ADR 0102): each turn takes the twelve this fan may
   * read, as her real drafts do (`examplesForTurn`).
   */
  readonly voiceExamples?: readonly VoiceExample[];
  /** Her languages and her messages in each (`languagesOf`), as her real drafts read them (ADR 0168). */
  readonly languages: PersonaLanguages;
  readonly timeZone?: string;
  readonly now?: () => Date;
  /**
   * Her pace of scripts: with it, the simulated fan is an invented adult and the policy decides on each offer as
   * for a real fan. Without it, she offers nothing.
   */
  readonly offerLimits?: OfferLimits;
  /** When she goes sexual: the simulated fan starts with his age unknown and confirms it by stating it. */
  readonly sexualizationLimits?: SexualizationLimits;
  /** Her follow-ups (`PersonaForModels.followUps`): without them, she never follows up. */
  readonly followUps?: { readonly delaysHours: readonly number[]; readonly spirit: string | null };
  /** Her replies to a price objection (ADR 0090 § B): picked as for a real fan, never twice in a session. */
  readonly objectionReplies?: ObjectionReplies;
  /**
   * Her own catalogue, read again at each of his messages as production does (one of her versions played). Absent:
   * the trial scripts. A read that fails sells nothing, as in production, and says why.
   */
  readonly herScripts?: () => Promise<Catalogue>;
}

/** A fact the brain proposed, as the screen and the brain read it back: in French, never a code (recette 12/11). */
function fanNote(fact: Brief['factsProposed'][number]): string {
  const category = FACT_CATEGORY_WORDS[fact.category] ?? fact.category;
  const key = kycSlotWords(fact.key);
  return `${category} / ${key} : ${fact.value} (${fact.kind === 'declared' ? 'dit par lui' : 'déduit'})`;
}

const FACT_CATEGORY_WORDS: Readonly<Record<string, string>> = {
  identity: 'identité',
  life: 'sa vie',
  interests: 'centres d’intérêt',
  preferences: 'goûts',
  commercial: 'achats',
  intimate: 'intime',
  events: 'événements',
  operator_note: 'note de l’équipe',
};

/** Why nothing was written, for the trace: the daily cap, or each model that failed. */
const failure = (error: LlmFailure): string =>
  error.code === 'budget_reached'
    ? 'plafond du jour atteint'
    : error.attempts.map((a) => `${a.model}: ${a.outcome}`).join(', ');

/**
 * Same path as production (brain, then voice, then guards) with no connector at all: nothing can be sent.
 * A blocked answer is shown as a trace and never enters the history.
 */
export function createPlaygroundSession(deps: PlaygroundDeps): PlaygroundSession {
  const history: ConversationTurn[] = [];
  // In-memory fan notes until the fans module stores facts (P3-02).
  const fanNotes: string[] = [];
  const personaSheet = deps.personaSheet;
  const voiceExamples = deps.voiceExamples ?? [];
  const startedAt = (deps.now ?? (() => new Date()))();
  let situation: Situation = {
    now: startedAt,
    timeZone: deps.timeZone ?? 'Europe/Paris',
    relationshipStartedAt: startedAt,
    spentCents: 0,
  };
  let lastExchange: PlaygroundExchange | undefined;
  // When the policy last let her offer, on the simulated clock: the cooldown is tested with `advance`.
  let lastOfferAt: Date | null = null;
  // His age, unknown until he states an adult one, as for a real fan (P3-09).
  let ageConfirmedAt: Date | null = null;
  // ADR 0090: an order of his waits once she answered it; the replies of her bank he already received.
  let customOrderOpen = false;
  const usedObjectionReplies: string[] = [];
  // His last message on the simulated clock, and the follow-ups she wrote since: the next step is their count.
  let lastFanAt: Date | null = null;
  let brainReading: NonNullable<PlaygroundTurn['brief']> | undefined;
  let followUpsSince = 0;
  // His desire score as `conversations` would store it (P3-12), on the simulated clock.
  let desire: DesireState | undefined;
  // His score before each of his messages: a branch goes back to it.
  const desireBefore: (DesireState | undefined)[] = [];
  // His availability as `conversations` would keep it (ADR 0103, amendement du 13/11), and before each message.
  let availability: FanAvailabilityRecord | null = null;
  const availabilityBefore: (FanAvailabilityRecord | null)[] = [];
  // His score as each of his messages left it, shown under the message.
  const desireTrail: (PlaygroundDesireReading | undefined)[] = [];
  // The trial scripts (ADR 0103 § 15-17): his run, and what Reveal's history would say he received and bought. The
  // history is what `reconcileScriptRun` trusts, as production trusts Reveal's: a step joins it once written.
  let scripts: TrialScripts = noScripts();
  // Where the scripts come from now, and every script seen in this session by its ref: a media she sent keeps its
  // step once her catalogue changed.
  let catalogue: Catalogue =
    deps.herScripts === undefined
      ? { source: 'trial', scripts: TRIAL_CATALOGUE, unavailable: null }
      : { source: 'hers', scripts: [], unavailable: null };
  const known = new Map<
    string,
    { readonly script: PlaygroundScript; readonly source: Catalogue['source'] }
  >();
  const learn = (read: Catalogue): void => {
    // None of hers can be played: the trial scripts take their place, and the screen says which and why.
    catalogue =
      read.source === 'hers' && read.scripts.length === 0
        ? { source: 'trial', scripts: TRIAL_CATALOGUE, unavailable: read.unavailable ?? 'none_ready' }
        : read;
    for (const script of catalogue.scripts)
      known.set(script.view.scriptRef, { script, source: catalogue.source });
  };
  learn(catalogue);
  const readCatalogue = async (): Promise<void> => {
    if (deps.herScripts === undefined) return;
    try {
      learn(await deps.herScripts());
    } catch {
      // Production would sell nothing: the trial scripts are played instead, and the screen says why.
      learn({ source: 'hers', scripts: [], unavailable: 'unreadable' });
    }
  };
  const scriptOf = (scriptRef: string): AgentScriptView | undefined => known.get(scriptRef)?.script.view;
  // The media of each step she sent, by turn: their refs, for the screen to draw them from her vault.
  const stepMedia = new WeakMap<
    ConversationTurn,
    readonly { readonly ref: string; readonly teaser: boolean }[]
  >();
  // Before each of his messages: a branch goes back to it.
  const scriptsBefore: TrialScripts[] = [];
  // The step each of her script media carries: the media turn is the one « Payer (fictif) » unlocks.
  const stepTurns = new WeakMap<
    ConversationTurn,
    { readonly scriptRef: string; readonly stepIndex: number }
  >();
  // When each turn was written, on the simulated clock: his reply speed counts in his score, as in production.
  const writtenAt = new WeakMap<ConversationTurn, Date>();
  const push = (turn: ConversationTurn): void => {
    writtenAt.set(turn, situation.now);
    history.push(turn);
  };
  // The history as composeTurn reads it, each turn with its time: the trainer sees the gaps he made with `advance`.
  const dated = (): ConversationTurn[] =>
    history.map((t) => ({ ...t, at: writtenAt.get(t) ?? situation.now }));
  const historyView = (): ScriptHistoryView => ({
    scripts: [...scripts.played].map(([scriptRef, played]) => ({
      scriptRef,
      sentStepIndexes: [...played.sent],
      boughtStepIndexes: [...played.bought],
    })),
  });
  /** His run moves: what each step became is kept, for the media that carry them once the run is over. */
  const moveRun = (run: ScriptRun | null): void => {
    if (run === null) return;
    const outcomes = new Map(scripts.outcomes);
    for (const step of run.steps) outcomes.set(stepKey(run.scriptRef, step.stepIndex), step.outcome);
    scripts = { ...scripts, run, outcomes };
  };
  const played = (scriptRef: string): { sent: Set<number>; bought: Set<number> } => {
    const known = scripts.played.get(scriptRef);
    if (known !== undefined) return known;
    const fresh = { sent: new Set<number>(), bought: new Set<number>() };
    scripts.played.set(scriptRef, fresh);
    return fresh;
  };
  /**
   * The step she wrote: the platform would now know it sent. Its message goes after her text as the platform sends it:
   * the step's own words, the teaser shown, and its media, locked while it is paid.
   */
  const sendStep = (script: AgentScriptView, stepIndex: number): void => {
    played(script.scriptRef).sent.add(stepIndex);
    const step = script.steps[stepIndex];
    const shown = known.get(script.scriptRef)?.script.steps[stepIndex];
    if (step === undefined || shown === undefined) return;
    const bundle = [
      ...shown.teaser.map((media) => ({ media, teaser: true })),
      ...shown.media.map((media) => ({ media, teaser: false })),
    ];
    if (bundle.length === 0 && shown.text === '') return;
    const turn: ConversationTurn = {
      from: 'creator',
      text: shown.text,
      ...(bundle.length > 0 && {
        media: bundle.map(({ media, teaser }) => ({
          description: completeMedia({ kind: media.kind, factualDescription: factualOf(media) }),
          isLocked: step.kind === 'paid' && !teaser,
        })),
      }),
    };
    stepTurns.set(turn, { scriptRef: script.scriptRef, stepIndex });
    stepMedia.set(
      turn,
      bundle.map(({ media, teaser }) => ({ ref: media.ref, teaser })),
    );
    push(turn);
  };
  /** The paid step waiting, its run and its script, or nothing. */
  const waiting = () => {
    const { run } = scripts;
    const script = run === null ? undefined : scriptOf(run.scriptRef);
    const step = run === null ? undefined : paidWaiting(run);
    return run === null || script === undefined || step === undefined ? undefined : { run, script, step };
  };

  const offerAt = (now: Date): OfferInput | undefined =>
    deps.offerLimits === undefined
      ? undefined
      : {
          now,
          lastOfferAt,
          hasNoBudget: false,
          flags: ageConfirmedAt === null ? {} : { ageConfirmedAt: ageConfirmedAt.toISOString() },
          limits: deps.offerLimits,
        };

  /**
   * What code measures of his heat, each turn at its time on the simulated clock. The clock moves only when the trainer
   * advances it: a reply at the very time of hers says nothing of his speed (he would get `quick_reply` on every
   * message), so his reply speed counts only once the clock moved between her message and his.
   */
  const measuredOnClock = (): DesireMeasure => {
    const measured = measureDesire(
      history.map((t) => ({
        fromFan: t.from === 'fan',
        text: t.text,
        at: writtenAt.get(t) ?? situation.now,
      })),
    );
    return measured.replySeconds === 0 ? { ...measured, replySeconds: null } : measured;
  };

  return {
    history,
    fanNotes,
    desireTrail,
    get situation() {
      return situation;
    },
    get lastExchange() {
      return lastExchange;
    },
    get reading() {
      return brainReading;
    },

    reset() {
      history.length = 0;
      fanNotes.length = 0;
      lastExchange = undefined;
      lastOfferAt = null;
      ageConfirmedAt = null;
      lastFanAt = null;
      followUpsSince = 0;
      desire = undefined;
      desireBefore.length = 0;
      availability = null;
      availabilityBefore.length = 0;
      desireTrail.length = 0;
      scripts = noScripts();
      scriptsBefore.length = 0;
      situation = { ...situation, relationshipStartedAt: situation.now, spentCents: 0 };
    },

    get scriptRun() {
      const { run } = scripts;
      const seen = run === null ? undefined : known.get(run.scriptRef);
      return run === null || seen === undefined
        ? null
        : { run, script: seen.script.view, name: seen.script.name, source: seen.source };
    },

    get catalogue() {
      return { source: catalogue.source, unavailable: catalogue.unavailable };
    },

    readCatalogue,

    stepMediaOf(turn) {
      return stepMedia.get(turn);
    },

    get fictiveSpentCents() {
      return scripts.fictiveSpentCents;
    },

    get salesFrozen() {
      return scripts.salesFrozen;
    },

    trialStepOf(turn) {
      const tag = stepTurns.get(turn);
      const seen = tag === undefined ? undefined : known.get(tag.scriptRef);
      const step = tag === undefined ? undefined : seen?.script.view.steps[tag.stepIndex];
      if (tag === undefined || seen === undefined || step === undefined) return undefined;
      const outcome = scripts.outcomes.get(stepKey(tag.scriptRef, tag.stepIndex));
      const open = waiting();
      const state: TrialStep['state'] =
        step.kind !== 'paid'
          ? 'offered'
          : outcome === 'bought' || outcome === 'refused'
            ? outcome
            : open?.run.scriptRef === tag.scriptRef && open.step.stepIndex === tag.stepIndex
              ? 'waiting'
              : 'closed';
      return { ...tag, source: seen.source, kind: step.kind, priceCents: step.priceMinor, state };
    },

    buyStep() {
      const open = waiting();
      if (open === undefined) return 'nothing_waiting';
      if (scripts.salesFrozen) return 'sales_frozen';
      const bought = applyScriptRunEvent(open.run, open.script, {
        type: 'step_bought',
        stepIndex: open.step.stepIndex,
        at: situation.now,
      });
      if (!bought.ok) return 'nothing_waiting';
      played(open.run.scriptRef).bought.add(open.step.stepIndex);
      moveRun(bought.run);
      const price = open.step.priceMinor ?? 0;
      scripts = { ...scripts, fictiveSpentCents: scripts.fictiveSpentCents + price };
      // His spending is what the brain reads of him: a fictive purchase counts there, never in the real figures.
      situation = { ...situation, spentCents: situation.spentCents + price };
      // The media he bought opens, as on Reveal: its turn is replaced, at the same time and with the same step.
      const index = history.findLastIndex((t) => {
        const tag = stepTurns.get(t);
        return tag?.scriptRef === open.run.scriptRef && tag.stepIndex === open.step.stepIndex;
      });
      const turn = history[index];
      if (turn !== undefined) {
        const opened: ConversationTurn = {
          ...turn,
          media: (turn.media ?? []).map((m) => ({ ...m, isLocked: false })),
        };
        writtenAt.set(opened, writtenAt.get(turn) ?? situation.now);
        stepTurns.set(opened, { scriptRef: open.run.scriptRef, stepIndex: open.step.stepIndex });
        const media = stepMedia.get(turn);
        if (media !== undefined) stepMedia.set(opened, media);
        history.splice(index, 1, opened);
      }
      return 'done';
    },

    refuseStep() {
      const open = waiting();
      if (open === undefined) return 'nothing_waiting';
      const refused = applyScriptRunEvent(open.run, open.script, { type: 'refused', at: situation.now });
      if (!refused.ok) return 'nothing_waiting';
      moveRun(refused.run);
      return 'done';
    },

    setSituation(patch) {
      situation = { ...situation, ...patch };
    },

    advance(ms) {
      situation = { ...situation, now: new Date(situation.now.getTime() + ms) };
    },

    setFanNotes(notes) {
      fanNotes.splice(0, fanNotes.length, ...notes);
    },

    confirmAge(at) {
      ageConfirmedAt = at;
    },

    sendCreatorMedia(description, isLocked) {
      push({ from: 'creator', text: '', media: [{ description, isLocked }] });
    },

    replaceLastAnswer(text) {
      // Her answer is the text turn after his last message; a media she sent since stays after it.
      const lastFan = history.findLastIndex((t) => t.from === 'fan');
      const answer = history.findIndex(
        (t, i) => i > lastFan && t.from === 'creator' && t.media === undefined,
      );
      const corrected: ConversationTurn = { from: 'creator', text };
      // The correction keeps the time her answer was written: his reply speed is measured from it.
      writtenAt.set(corrected, writtenAt.get(history[answer] ?? corrected) ?? situation.now);
      if (answer === -1) history.splice(lastFan + 1, 0, corrected);
      else history.splice(answer, 1, corrected);
    },

    branchAt(fanMessageNumber) {
      let seen = 0;
      const index = history.findIndex((t) => t.from === 'fan' && (seen += 1) === fanMessageNumber);
      const turn = history[index];
      if (turn === undefined) return undefined;
      history.splice(index);
      desire = desireBefore[fanMessageNumber - 1];
      desireBefore.length = fanMessageNumber - 1;
      availability = availabilityBefore[fanMessageNumber - 1] ?? null;
      availabilityBefore.length = fanMessageNumber - 1;
      desireTrail.length = fanMessageNumber - 1;
      const before = scriptsBefore[fanMessageNumber - 1];
      if (before !== undefined) {
        // What he paid fictively after that message is given back with the rest.
        const refund = scripts.fictiveSpentCents - before.fictiveSpentCents;
        situation = { ...situation, spentCents: Math.max(0, situation.spentCents - refund) };
        scripts = before;
      }
      scriptsBefore.length = fanMessageNumber - 1;
      lastExchange = undefined;
      return { text: turn.text, media: (turn.media ?? []).map((m) => m.description) };
    },

    async compareVoice(gateway) {
      const input = lastExchange?.voiceInput;
      if (input === undefined) return undefined;
      const voice = await gateway.voice(input);
      const written = voice.ok ? voice.value.output.bubbles : [];
      const violations = checkVoiceOutput(written, deps.guardSettings, guardContextOf(input.history));
      const bubbles = asSent(written, deps.splitMessages);
      return {
        bubbles,
        violations,
        isBlocked: isBlocked(violations) || !voice.ok,
        ...(voice.ok && { model: voice.value.meta.model }),
        costUsd: voice.ok ? (voice.value.meta.costUsd ?? 0) : 0,
        ...(!voice.ok && { failure: failure(voice.error) }),
      };
    },

    async followUp() {
      if (lastFanAt === null || history.at(-1)?.from !== 'creator') return { kind: 'nothing_to_follow_up' };
      const delays = deps.followUps?.delaysHours ?? [];
      const step = followUpsSince;
      const hours = delays[step];
      const silentMs = situation.now.getTime() - lastFanAt.getTime();
      if (hours !== undefined && silentMs < hours * 3_600_000) {
        return { kind: 'not_due', step, dueAt: new Date(lastFanAt.getTime() + hours * 3_600_000) };
      }
      // The simulated fan is an invented adult with no limit set: only the plan and her clock decide.
      const decision = followUpDecision({
        step,
        steps: delays.length,
        flags: {},
        now: situation.now,
        timeZone: situation.timeZone,
      });
      if (decision.kind !== 'write') return decision;
      const composed = await composeTurn(
        deps.gateway,
        {
          creatorName: deps.creatorName,
          personaSheet,
          ...(deps.profileBio !== undefined && { profileBio: deps.profileBio }),
          guardSettings: deps.guardSettings,
          ...(deps.splitMessages !== undefined && { splitMessages: deps.splitMessages }),
          ...(voiceExamples.length > 0 && { voiceExamples }),
          ...deps.languages,
        },
        {
          history: dated(),
          fanText: '',
          media: [],
          fanNotes: fanNotes.join('\n'),
          situation,
          followUp: { silentHours: silentMs / 3_600_000, spirit: deps.followUps?.spirit ?? null },
        },
      );
      if (!composed.isBlocked) {
        push({ from: 'creator', text: composed.bubbles.join('\n') });
        followUpsSince += 1;
      }
      lastExchange = undefined;
      return {
        kind: 'written',
        step,
        turn: {
          ...(composed.brief !== undefined && { brief: composed.brief }),
          bubbles: composed.bubbles,
          ...(composed.voiceFailure !== undefined && { voiceFailure: failure(composed.voiceFailure) }),
          violations: composed.violations,
          isBlocked: composed.isBlocked,
          costUsd: composed.costUsd,
          latencyMs: composed.latencyMs,
          ...(composed.model !== undefined && { model: composed.model }),
          isFallback: composed.isFallback,
        },
      };
    },

    async handleFanMessage(text, media = []) {
      brainReading = undefined;
      lastFanAt = situation.now;
      followUpsSince = 0;
      desireBefore.push(desire);
      availabilityBefore.push(availability);
      desireTrail.push(undefined);
      scriptsBefore.push(copyScripts(scripts));
      push({ from: 'fan', text, media: media.map((description) => ({ description })) });
      // Her catalogue as it is now, as production reads it at each message.
      await readCatalogue();
      const moment: RatedMoment = {
        history: dated(),
        fanNotes: fanNotes.join('\n'),
        situation,
      };
      // The safety net in code, read before any model as production does (draft-composer.ts): he says plainly he is a
      // minor, a human answers him and no model is called; he says he wants to hurt himself, she answers with care
      // whatever the brain reads.
      // On all he wrote since her last answer, joined, as production reads it: an age said over two messages counts.
      const lastAnswer = history.findLastIndex((t) => t.from === 'creator');
      const signs = safetySigns(
        history
          .slice(lastAnswer + 1)
          .map((t) => t.text)
          .join('\n'),
      );
      if (signs.includes('minor_suspected')) {
        scripts = { ...scripts, salesFrozen: true };
        const held: PlaygroundTurn = {
          bubbles: [],
          violations: [],
          isBlocked: true,
          costUsd: 0,
          latencyMs: 0,
          isFallback: false,
          hold: { kind: 'handoff', detail: ['safety_net', ...signs] },
        };
        lastExchange = { fanMessage: text, turn: held, moment };
        return held;
      }
      const careForced = signs.length > 0;
      const offer = offerAt(situation.now);
      const composed = await composeTurn(
        deps.gateway,
        {
          creatorName: deps.creatorName,
          personaSheet,
          ...(deps.profileBio !== undefined && { profileBio: deps.profileBio }),
          guardSettings: deps.guardSettings,
          ...(deps.splitMessages !== undefined && { splitMessages: deps.splitMessages }),
          ...(voiceExamples.length > 0 && { voiceExamples }),
          ...deps.languages,
        },
        {
          history: dated(),
          fanText: text,
          media,
          fanNotes: moment.fanNotes,
          situation,
          ...(offer !== undefined && { offer }),
          // Her scripts or the trial ones, read as production reads her catalogue and Reveal's history (ADR 0103 § 15):
          // the same decision.
          scripts: {
            conversationRef: 'playground',
            catalogue: catalogue.scripts.map((script) => script.view),
            history: historyView(),
            latest: scripts.run,
            countsHisMessage: true,
          },
          // No chatter in the playground: a custom order is answered committing to nothing, as with nobody on shift.
          customOrder: {
            chatterOnShift: false,
            orderOpen: customOrderOpen,
            flags: ageConfirmedAt === null ? {} : { ageConfirmedAt: ageConfirmedAt.toISOString() },
          },
          ...(deps.objectionReplies !== undefined && {
            objections: { bank: deps.objectionReplies, usedReplyIds: new Set(usedObjectionReplies) },
          }),
          ...(deps.sexualizationLimits !== undefined && {
            sexualization: {
              limits: deps.sexualizationLimits,
              ageConfirmed: ageConfirmedAt !== null,
              noExplicit: false,
            },
          }),
          availability,
          // The risk policy as the composer runs it (agent/domain/hold.ts): a possible minor or a dangerous request
          // hands over and the voice does not write; distress is answered with care; without the brain's reading
          // nobody knows the risks, so the voice does not write either (AGE-01).
          // Called once the brain has read him, before the voice: the screen shows the reading while she writes.
          care: (brief) => {
            brainReading = brief;
            return careForced || (brief !== undefined && holdDecision(brief).kind === 'care');
          },
          skipVoice: (brief) => {
            if (brief === undefined) return !careForced;
            const kind = holdDecision(brief).kind;
            return kind === 'handoff' || (kind === 'no_reply' && !careForced);
          },
          desire: {
            ...(desire !== undefined && { previous: desire }),
            measured: measuredOnClock(),
            ageDisputed: false,
            counted: false,
          },
        },
      );
      brainReading = undefined;
      const decided = composed.brief === undefined ? undefined : holdDecision(composed.brief);
      const hold: PlaygroundTurn['hold'] =
        decided?.kind === 'handoff' || (decided?.kind === 'care' && !careForced)
          ? decided
          : careForced
            ? {
                kind: 'care',
                detail: ['safety_net', ...signs, ...(decided?.kind === 'care' ? decided.detail : [])],
              }
            : decided?.kind === 'no_reply'
              ? decided
              : undefined;
      if (hold?.kind === 'handoff' || hold?.kind === 'care') scripts = { ...scripts, salesFrozen: true };
      if (composed.desire !== undefined) desire = { score: composed.desire.score, at: situation.now };
      if (composed.availability !== undefined) availability = composed.availability.record;
      if (composed.customOrder?.kind === 'reply' && composed.customOrder.opens) customOrderOpen = true;
      if (composed.objectionReply !== undefined && !composed.isBlocked)
        usedObjectionReplies.push(composed.objectionReply.replyId);
      if (composed.ageDeclared !== undefined && ageConfirmedAt === null) ageConfirmedAt = situation.now;
      if (composed.voiceBrief?.action === 'offer' && !composed.isBlocked) {
        lastOfferAt = situation.now;
      }
      // In-memory fan notes until the fans module stores facts (P3-02).
      for (const fact of withoutOrders(composed.brief?.factsProposed ?? [])) fanNotes.push(fanNote(fact));
      if (!composed.isBlocked) push({ from: 'creator', text: composed.bubbles.join('\n') });
      // His run as production keeps it (draft-composer `withScripts`): a step written is sent, with its media after
      // her text; nothing written, the run follows his message only.
      const turnOfScripts = composed.scripts;
      if (turnOfScripts !== undefined) {
        const { decision } = turnOfScripts;
        const stepGoes =
          !composed.isBlocked &&
          turnOfScripts.script !== null &&
          (decision.kind === 'start' || decision.kind === 'send_step');
        if (stepGoes) {
          moveRun(turnOfScripts.opened?.run ?? turnOfScripts.moved?.run ?? null);
          sendStep(turnOfScripts.script, decision.step.stepIndex);
        } else if (composed.isBlocked) {
          moveRun(turnOfScripts.followed?.run ?? null);
        } else {
          moveRun(turnOfScripts.moved?.run ?? turnOfScripts.followed?.run ?? null);
        }
      }
      const read = composed.desireRead;
      const reading: PlaygroundDesireReading | undefined =
        read === undefined
          ? undefined
          : {
              before: read.before,
              score: read.score,
              band: desireBandOf(read.score),
              signals: read.signals,
              weightsVersion: read.weightsVersion,
              ...(composed.availability !== undefined &&
                composed.scriptStart !== undefined && {
                  availability: {
                    record: composed.availability.record,
                    gate: composed.scriptStart,
                    // She asked on this message only if `askedAt` moved: the clock may stand still between two.
                    asked: askedNow(availabilityBefore.at(-1) ?? null, composed.availability.record),
                  },
                }),
            };
      desireTrail[desireTrail.length - 1] = reading;

      const turn: PlaygroundTurn = {
        ...(composed.handoff !== undefined && { handoff: composed.handoff }),
        ...(composed.trap !== undefined && { trap: composed.trap }),
        ...(composed.brief !== undefined && { brief: composed.brief }),
        ...(composed.briefFailure !== undefined && { briefFailure: failure(composed.briefFailure) }),
        bubbles: composed.bubbles,
        ...(composed.voiceFailure !== undefined && { voiceFailure: failure(composed.voiceFailure) }),
        violations: composed.violations,
        isBlocked: composed.isBlocked,
        costUsd: composed.costUsd,
        latencyMs: composed.latencyMs,
        ...(composed.model !== undefined && { model: composed.model }),
        isFallback: composed.isFallback,
        ...(reading !== undefined && { desire: reading }),
        ...(composed.sexualization !== undefined && {
          cursor: {
            kind: composed.sexualization.kind,
            ...(composed.sexualization.kind === 'steer_back' && { reason: composed.sexualization.reason }),
          },
        }),
        ...(composed.offerRefused !== undefined && {
          offerRefused: scriptRefusal(composed.offerRefused, composed.scripts?.decision),
        }),
        ...(hold !== undefined && { hold }),
      };
      lastExchange = {
        fanMessage: text,
        turn,
        moment: composed.voiceBrief === undefined ? moment : { ...moment, brief: composed.voiceBrief },
        ...(composed.voiceInput !== undefined && { voiceInput: composed.voiceInput }),
      };
      return turn;
    },
  };
}

/** The trial scripts' state in one session (ADR 0103 § 15-17). */
interface TrialScripts {
  readonly run: ScriptRun | null;
  /** By script: the steps Reveal would say he received and bought. */
  readonly played: Map<string, { sent: Set<number>; bought: Set<number> }>;
  /** What each step sent became, by `script:index`, kept once its run is over. */
  readonly outcomes: ReadonlyMap<string, ScriptRun['steps'][number]['outcome']>;
  readonly fictiveSpentCents: number;
  readonly salesFrozen: boolean;
}

const noScripts = (): TrialScripts => ({
  run: null,
  played: new Map(),
  outcomes: new Map(),
  fictiveSpentCents: 0,
  salesFrozen: false,
});

const copyScripts = (scripts: TrialScripts): TrialScripts => ({
  ...scripts,
  played: new Map(
    [...scripts.played].map(([ref, p]) => [ref, { sent: new Set(p.sent), bought: new Set(p.bought) }]),
  ),
  outcomes: new Map(scripts.outcomes),
});

const stepKey = (scriptRef: string, stepIndex: number): string => `${scriptRef}:${String(stepIndex)}`;

/** What the brain reads of a media she sent: its description, cut to what a media description holds. */
const factualOf = (media: ShownMedia): string => {
  const written = media.description?.trim() ?? '';
  return written === '' ? 'Un média de son script, sans description.' : written.slice(0, 800);
};

/**
 * With her scripts read, the brain's offer is refused as `no_script_step`: the trainer reads why no step went instead,
 * from the scripts' own decision (the gate, the policy, a step waiting, a refusal).
 */
function scriptRefusal(
  refused: string,
  decision: NonNullable<Awaited<ReturnType<typeof composeTurn>>['scripts']>['decision'] | undefined,
): string {
  if (refused !== 'no_script_step' || decision === undefined) return refused;
  switch (decision.kind) {
    case 'none':
      return decision.reason;
    case 'wait':
      return 'reason' in decision ? decision.reason : 'step_waiting';
    case 'after_refusal':
      return 'after_refusal';
    case 'end':
      return 'script_ended';
    case 'start':
    case 'send_step':
      return refused;
  }
}
