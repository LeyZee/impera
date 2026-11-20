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
} from '../../agent/index';
import { kycSlotWords } from '../domain/labels';

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
  readonly guardSettings: GuardSettings;
  /** False: her answer is shown as one message, as the fan would get it (`behavior.split_messages`). */
  readonly splitMessages?: boolean;
  /**
   * Her bank's examples her hard guards let through, newest first (ADR 0102): each turn takes the twelve this fan may
   * read, as her real drafts do (`examplesForTurn`).
   */
  readonly voiceExamples?: readonly VoiceExample[];
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
  // When each turn was written, on the simulated clock: his reply speed counts in his score, as in production.
  const writtenAt = new WeakMap<ConversationTurn, Date>();
  const push = (turn: ConversationTurn): void => {
    writtenAt.set(turn, situation.now);
    history.push(turn);
  };
  // The history as composeTurn reads it, each turn with its time: the trainer sees the gaps he made with `advance`.
  const dated = (): ConversationTurn[] =>
    history.map((t) => ({ ...t, at: writtenAt.get(t) ?? situation.now }));
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
          ...(voiceExamples.length > 0 && { voiceExamples }),
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
      push({ from: 'fan', text, media: media.map((description) => ({ description })) });
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
          guardSettings: deps.guardSettings,
          ...(deps.splitMessages !== undefined && { splitMessages: deps.splitMessages }),
          ...(voiceExamples.length > 0 && { voiceExamples }),
        },
        {
          history: dated(),
          fanText: text,
          media,
          fanNotes: moment.fanNotes,
          situation,
          ...(offer !== undefined && { offer }),
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
        ...(composed.offerRefused !== undefined && { offerRefused: composed.offerRefused }),
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
