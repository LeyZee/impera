import { desireBandOf, type DesireBand, type DesireSignal, type MediaDescription } from '@nirvana/contracts';
import type { Brief, ConversationTurn, LlmFailure, LlmGateway, VoiceInput } from '@nirvana/llm';

import {
  asSent,
  checkVoiceOutput,
  composeTurn,
  followUpDecision,
  guardContextOf,
  withExamples,
  withoutOrders,
  isBlocked,
  type GuardSettings,
  type GuardViolation,
  type FollowUpDecision,
  measureDesire,
  type DesireState,
  type OfferInput,
  type OfferLimits,
  type RatedMoment,
  type SexualizationLimits,
  type Situation,
  type TrapAssessment,
} from '../../agent/index';

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
  /** His desire score after this message, when it moved (P3-12): what the policy read. */
  readonly desire?: {
    readonly score: number;
    readonly band: DesireBand;
    readonly signals: readonly DesireSignal[];
  };
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

export interface PlaygroundSession {
  /** His message, with the descriptions of the media he sends with it. */
  handleFanMessage(text: string, media?: readonly MediaDescription[]): Promise<PlaygroundTurn>;
  /** She sends one of her media (a teaser, or a locked paid one he can ask about). */
  sendCreatorMedia(description: MediaDescription, isLocked: boolean): void;
  /** Her answer as the team rewrote it: the conversation goes on from the corrected version. */
  replaceLastAnswer(text: string): void;
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
  reset(): void;
  readonly history: readonly ConversationTurn[];
  readonly fanNotes: readonly string[];
  readonly situation: Situation;
  readonly lastExchange: PlaygroundExchange | undefined;
}

export interface PlaygroundDeps {
  readonly gateway: LlmGateway;
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly guardSettings: GuardSettings;
  /** False: her answer is shown as one message, as the fan would get it (`behavior.split_messages`). */
  readonly splitMessages?: boolean;
  /** Answers the team corrected earlier: given to the voice as her examples (they take precedence). */
  readonly voiceExamples?: readonly string[];
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
}

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
  const personaSheet = withExamples(deps.personaSheet, deps.voiceExamples ?? []);
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
  // His last message on the simulated clock, and the follow-ups she wrote since: the next step is their count.
  let lastFanAt: Date | null = null;
  let followUpsSince = 0;
  // His desire score as `conversations` would store it (P3-12), on the simulated clock.
  let desire: DesireState | undefined;
  // His score before each of his messages: a branch goes back to it.
  const desireBefore: (DesireState | undefined)[] = [];
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

  return {
    history,
    fanNotes,
    get situation() {
      return situation;
    },
    get lastExchange() {
      return lastExchange;
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
      situation = { ...situation, relationshipStartedAt: situation.now, spentCents: 0 };
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

    sendCreatorMedia(description, isLocked) {
      history.push({ from: 'creator', text: '', media: [{ description, isLocked }] });
    },

    replaceLastAnswer(text) {
      // Her answer is the text turn after his last message; a media she sent since stays after it.
      const lastFan = history.findLastIndex((t) => t.from === 'fan');
      const answer = history.findIndex(
        (t, i) => i > lastFan && t.from === 'creator' && t.media === undefined,
      );
      if (answer === -1) history.splice(lastFan + 1, 0, { from: 'creator', text });
      else history.splice(answer, 1, { from: 'creator', text });
    },

    branchAt(fanMessageNumber) {
      let seen = 0;
      const index = history.findIndex((t) => t.from === 'fan' && (seen += 1) === fanMessageNumber);
      const turn = history[index];
      if (turn === undefined) return undefined;
      history.splice(index);
      desire = desireBefore[fanMessageNumber - 1];
      desireBefore.length = fanMessageNumber - 1;
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
          guardSettings: deps.guardSettings,
          ...(deps.splitMessages !== undefined && { splitMessages: deps.splitMessages }),
        },
        {
          history: [...history],
          fanText: '',
          media: [],
          fanNotes: fanNotes.join('\n'),
          situation,
          followUp: { silentHours: silentMs / 3_600_000, spirit: deps.followUps?.spirit ?? null },
        },
      );
      if (!composed.isBlocked) {
        history.push({ from: 'creator', text: composed.bubbles.join('\n') });
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
      lastFanAt = situation.now;
      followUpsSince = 0;
      desireBefore.push(desire);
      history.push({ from: 'fan', text, media: media.map((description) => ({ description })) });
      const moment: RatedMoment = {
        history: [...history],
        fanNotes: fanNotes.join('\n'),
        situation,
      };
      const offer = offerAt(situation.now);
      const composed = await composeTurn(
        deps.gateway,
        {
          creatorName: deps.creatorName,
          personaSheet,
          guardSettings: deps.guardSettings,
          ...(deps.splitMessages !== undefined && { splitMessages: deps.splitMessages }),
        },
        {
          history: [...history],
          fanText: text,
          media,
          fanNotes: moment.fanNotes,
          situation,
          ...(offer !== undefined && { offer }),
          ...(deps.sexualizationLimits !== undefined && {
            sexualization: {
              limits: deps.sexualizationLimits,
              ageConfirmed: ageConfirmedAt !== null,
              noExplicit: false,
            },
          }),
          desire: {
            ...(desire !== undefined && { previous: desire }),
            // No clock per message here: his reply speed is not measured.
            measured: {
              ...measureDesire(
                history.map((t) => ({ fromFan: t.from === 'fan', text: t.text, at: situation.now })),
              ),
              replySeconds: null,
            },
            ageDisputed: false,
            counted: false,
          },
        },
      );
      if (composed.desire !== undefined) desire = { score: composed.desire.score, at: situation.now };
      if (composed.ageDeclared !== undefined && ageConfirmedAt === null) ageConfirmedAt = situation.now;
      if (composed.voiceBrief?.action === 'offer' && !composed.isBlocked) {
        lastOfferAt = situation.now;
      }
      // In-memory fan notes until the fans module stores facts (P3-02).
      for (const fact of withoutOrders(composed.brief?.factsProposed ?? []))
        fanNotes.push(`${fact.category} / ${fact.key} : ${fact.value} (${fact.kind})`);
      if (!composed.isBlocked) history.push({ from: 'creator', text: composed.bubbles.join('\n') });

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
        ...(composed.desire !== undefined && {
          desire: {
            score: composed.desire.score,
            band: desireBandOf(composed.desire.score),
            signals: composed.desire.signals,
          },
        }),
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
