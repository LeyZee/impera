import { desireNow, type MediaDescription } from '@nirvana/contracts';
import type {
  BrainAlert,
  Brief,
  CallTrace,
  ConversationTurn,
  LlmFailure,
  LlmGateway,
  VoiceInput,
} from '@nirvana/llm';

import {
  desireMoved,
  desireScore,
  NO_MEASURE,
  type DesireMeasure,
  type DesireReading,
  type DesireState,
} from '../domain/desire';
import {
  checkExplicit,
  checkVoiceOutput,
  previousTurnsOf,
  type GuardContext,
  isBlocked,
  type GuardSettings,
  type GuardViolation,
} from '../domain/guards';
import { screenNotes } from '../domain/injection';
import { offerDecision, offerSignals, type OfferBlock, type OfferContext } from '../domain/policy';
import {
  declaredAdultAge,
  sexualizationDecision,
  type SexualizationDecision,
  type SexualizationLimits,
} from '../domain/sexualization';
import { describeSituation, type Situation } from '../domain/situation';
import { assessTrap, screenMedia, type TrapAssessment } from '../domain/traps';

/** Who she is for the models: one persona, read by the composition root. */
export interface ComposerPersona {
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly guardSettings: GuardSettings;
  /** False: her answer goes out as one message (`behavior.split_messages`). Absent: as the voice wrote it. */
  readonly splitMessages?: boolean;
}

/** What the fan receives: her bubbles, or one message when she does not split hers. */
export function asSent(bubbles: readonly string[], splitMessages = true): readonly string[] {
  return splitMessages || bubbles.length <= 1 ? bubbles : [bubbles.join('\n')];
}

export interface ComposeTurnInput {
  /** The conversation so far, his last message(s) included, oldest first. */
  readonly history: readonly ConversationTurn[];
  /** His last message(s) since her last answer: what the traps read. */
  readonly fanText: string;
  readonly media: readonly MediaDescription[];
  readonly fanNotes: string;
  readonly situation: Situation;
  readonly trace?: CallTrace;
  /**
   * What the policy reads to let her offer, besides the brain's reading (`offerDecision`). Absent, the policy
   * cannot decide and she offers nothing: a brain's « offer » is written as a plain answer.
   */
  readonly offer?: OfferInput;
  /**
   * When she may go sexual (`sexualizationDecision`): her limits, and whether his age is confirmed. Absent, it is
   * as if his age were unknown: she does not open it, and steers back a fan who does.
   */
  readonly sexualization?: {
    readonly limits: SexualizationLimits;
    readonly ageConfirmed: boolean;
    /** A human's « rien d'explicite » for him. */
    readonly noExplicit: boolean;
  };
  /**
   * A follow-up on his silence (P3-10), not an answer: nothing of his to read, so no brain call. The voice writes a
   * light message from a brief set by code, with nothing to buy and nothing sexual, checked by every guard.
   */
  readonly followUp?: FollowUpTurn;
  /**
   * She already waited once for his last message (« attends, je reviens », P3-11): a brain that would wait again is
   * overruled, she asks him lightly whether he is back.
   */
  readonly waited?: boolean;
  /**
   * His desire score (P3-12): as stored, what code measured on his last messages, and whether his age was taken
   * back. Absent, he starts from 0 with nothing measured.
   */
  readonly desire?: DesireInput;
  /** Read once the brain has spoken: true stops before the voice (a handoff, nothing to answer), at no cost. */
  readonly skipVoice?: (brief: Brief | undefined) => boolean;
  /** Her alerts written as a phrase, for the brain to check his last message against (P4-01). */
  readonly alerts?: readonly BrainAlert[];
}

/** A follow-up as the voice writes it: how long he has been silent, and her own way of following up if she wrote one. */
interface FollowUpTurn {
  readonly silentHours: number;
  /** `follow_ups.text` when her type is « custom »: the spirit of her follow-ups, written by the team. */
  readonly spirit: string | null;
}

/** What his desire score is counted from (`desireScore`). */
interface DesireInput {
  readonly previous?: DesireState;
  readonly measured: DesireMeasure;
  readonly ageDisputed: boolean;
  /**
   * His last message was already counted in `previous` (a second pass after a wait, a replay): the score is read
   * as stored, decayed, and nothing new is counted.
   */
  readonly counted: boolean;
}

/** The policy's facts on him for an offer; his heat comes from his desire score, the risks from the brain. */
export type OfferInput = Omit<OfferContext, 'desire' | 'fanAsksForPaid' | 'risks'>;

/** Why the brain's offer was not written: the policy's reason, or nothing to decide on. */
type OfferRefusal = OfferBlock | 'no_offer_context';

/** What the voice writes instead of an offer the policy refused: an answer, nothing to buy. */
const NO_OFFER_BRIEF =
  'Réponds à ce qu’il vient de dire et garde la complicité, sans rien proposer de payant, sans parler de prix ni de contenu à acheter.';

function offerRefusal(brief: Brief, offer: OfferInput | undefined, desire: number): OfferRefusal | undefined {
  if (offer === undefined) return 'no_offer_context';
  const { fanAsksForPaid } = offerSignals(brief);
  const decision = offerDecision({ ...offer, desire, fanAsksForPaid, risks: brief.risks });
  return decision.allowed ? undefined : decision.reason;
}

const HOUR_MS = 3_600_000;
// Never closed hours: the cursor cannot let her go if her limits are unknown.
const NO_LIMITS: SexualizationLimits = {
  initiateAfterHours: Number.POSITIVE_INFINITY,
  minHoursBeforeFollowing: Number.POSITIVE_INFINITY,
  minDesireToOpen: Number.POSITIVE_INFINITY,
};

/** What the voice writes when he goes there too early: she slows down in her own voice, no lesson, no explicit. */
const STEER_BACK_BRIEF: Readonly<Record<'age_unconfirmed' | 'too_early', string>> = {
  too_early:
    'Il va trop vite : elle ralentit avec douceur et humour, sans rien d’explicite ni de sous-entendu, sans reproche, et ramène la conversation sur lui (ce qu’il fait, ce qu’il aime).',
  age_unconfirmed:
    'Il va trop vite : elle ralentit avec douceur et humour, sans rien d’explicite ni de sous-entendu, sans reproche, et ramène la conversation sur lui ; si ça vient naturellement, elle lui demande son âge.',
};
const NO_OPENING_HINT = 'aucune allusion sexuelle, elle n’ouvre pas ce terrain';
const SUGGESTIVE_HINT = 'suggestive seulement, jamais explicite';

/** What the voice writes for a follow-up: decided by code, never by the brain (CLAUDE.md rule 3). */
function followUpBrief(followUp: FollowUpTurn): Brief {
  const hours = Math.max(1, Math.round(followUp.silentHours));
  const spirit = followUp.spirit === null ? '' : ` Dans l’esprit de ses relances : ${followUp.spirit}`;
  return {
    intent: 'other',
    sentiment: 'neutral',
    factsProposed: [],
    kycMissing: [],
    risks: [],
    action: 'reply',
    replyBrief: `Il ne lui a rien répondu depuis ${String(hours)} h. Elle lui écrit un petit message léger qui rebondit sur ce dont ils parlaient ou prend de ses nouvelles, sans reproche, sans rien proposer de payant, sans parler de prix.${spirit}`,
    toneHints: [NO_OPENING_HINT, 'court, une seule bulle'],
  };
}

/** What the voice writes when she waited for him once and he has not written since (P3-11), set by code. */
const CAME_BACK_BRIEF =
  'Il lui avait dit d’attendre un peu et n’a rien écrit depuis. Elle lui demande avec légèreté s’il est revenu, en une phrase, sans reproche, sans rien proposer de payant.';

/** The brief as the cursor lets the voice write it. */
function withinCursor(brief: Brief, decision: SexualizationDecision): Brief {
  if (decision.kind === 'steer_back')
    return { ...brief, action: 'reply', replyBrief: STEER_BACK_BRIEF[decision.reason] };
  if (decision.kind === 'no_opening') return { ...brief, toneHints: [...brief.toneHints, NO_OPENING_HINT] };
  if (decision.kind === 'suggestive_only')
    return { ...brief, toneHints: [...brief.toneHints, SUGGESTIVE_HINT] };
  return brief;
}

/** One answer, from the brain to the guards: the same path for the playground and for a real fan. */
export interface ComposedTurn {
  /** Safety flags on his media: a human takes over, nothing was written. */
  readonly handoff?: readonly string[];
  readonly trap?: TrapAssessment;
  /** Lines of her notes shaped like an order: kept out of the prompt (agent/domain/injection.ts). */
  readonly droppedNotes?: readonly string[];
  readonly brief?: Brief;
  readonly briefFailure?: LlmFailure;
  /** What the cursor decided for this answer; absent when the brain did not read the moment. */
  readonly sexualization?: SexualizationDecision;
  /** His desire score after this message, only when it changed: the worker writes it (P3-12). */
  readonly desire?: DesireReading;
  /** An adult age he stated himself in this message (`declaredAdultAge`): the composer may confirm his age. */
  readonly ageDeclared?: number;
  /** The brain suggested an offer and the policy refused it: the voice wrote a plain answer. */
  readonly offerRefused?: OfferRefusal;
  /** What the voice was asked to write: kept for a comparison or a rating. */
  readonly voiceBrief?: Brief;
  readonly voiceInput?: VoiceInput;
  readonly bubbles: readonly string[];
  readonly voiceFailure?: LlmFailure;
  readonly violations: readonly GuardViolation[];
  readonly isBlocked: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly model?: string;
  readonly isFallback: boolean;
  /** `skipVoice` stopped it: no voice call was made. */
  readonly isSkipped?: boolean;
}

/** Answers the team corrected in the playground, given to the voice as her examples (they take precedence). */
export function withExamples(sheet: string, examples: readonly string[]): string {
  if (examples.length === 0) return sheet;
  return `${sheet}\n\nExemples de ses messages, corrigés par l'équipe :\n${examples.map((e) => `- ${e}`).join('\n')}`;
}

/**
 * What her guards read the draft against (P3-13): an engine draft never carries a media (a media goes out through
 * a script or a human), and her last turns are in the history.
 */
export function guardContextOf(history: readonly ConversationTurn[]): GuardContext {
  return {
    hasMedia: false,
    previousTurns: previousTurnsOf(
      history.map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })),
    ),
  };
}

/** His messages before the ones she is answering: the history without its last run of fan turns. */
function earlierFanTexts(history: readonly ConversationTurn[]): string[] {
  let end = history.length;
  while (end > 0 && history[end - 1]?.from === 'fan') end -= 1;
  return history
    .slice(0, end)
    .filter((turn) => turn.from === 'fan')
    .map((turn) => turn.text);
}

const NEUTRAL_BRIEF: Brief = {
  intent: 'other',
  sentiment: 'neutral',
  factsProposed: [],
  kycMissing: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui répondre dans la continuité de la conversation.',
  toneHints: [],
};

/**
 * A follow-up: the voice from the code's brief, then every guard, the explicit one whatever his age. No trap, cursor
 * or offer to decide: there is no new message of his.
 */
async function writeFollowUp(
  gateway: LlmGateway,
  persona: ComposerPersona,
  base: Omit<VoiceInput, 'brief'>,
  brief: Brief,
  droppedNotes: readonly string[],
): Promise<ComposedTurn> {
  const voiceInput: VoiceInput = { ...base, brief };
  const voice = await gateway.voice(voiceInput);
  const written = voice.ok ? voice.value.output.bubbles : [];
  const violations = [
    ...checkVoiceOutput(written, persona.guardSettings, guardContextOf(base.history)),
    ...checkExplicit(written),
  ];
  return {
    ...(droppedNotes.length > 0 && { droppedNotes }),
    brief,
    voiceBrief: brief,
    voiceInput,
    bubbles: asSent(written, persona.splitMessages),
    ...(!voice.ok && { voiceFailure: voice.error }),
    violations,
    isBlocked: isBlocked(violations) || !voice.ok,
    costUsd: voice.ok ? (voice.value.meta.costUsd ?? 0) : 0,
    latencyMs: voice.ok ? voice.value.meta.latencyMs : 0,
    ...(voice.ok && { model: voice.value.meta.model }),
    isFallback: voice.ok && voice.value.meta.isFallback,
  };
}

/** His score after this message, or undefined when it was already counted. */
function desireOf(brief: Brief, input: ComposeTurnInput): DesireReading | undefined {
  const desire = input.desire;
  if (desire?.counted === true) return undefined;
  return desireScore({
    previous: desire?.previous,
    signals: brief.desireSignals ?? [],
    intent: brief.intent,
    sentiment: brief.sentiment,
    measured: desire?.measured ?? NO_MEASURE,
    risks: brief.risks,
    ageDisputed: desire?.ageDisputed === true,
    now: input.situation.now,
  });
}

/** Brain, then voice, then guards. Writes nothing and sends nothing: the caller decides what the answer becomes. */
export async function composeTurn(
  gateway: LlmGateway,
  persona: ComposerPersona,
  input: ComposeTurnInput,
): Promise<ComposedTurn> {
  const screening = screenMedia(input.media);
  if (screening.mustHandoff) {
    return {
      handoff: screening.flags,
      bubbles: [],
      violations: [],
      isBlocked: true,
      costUsd: 0,
      latencyMs: 0,
      isFallback: false,
    };
  }
  const notes = screenNotes(input.fanNotes);
  const base = {
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    fanNotes: notes.kept,
    situation: describeSituation(input.situation),
    history: input.history,
    ...(input.trace !== undefined && { trace: input.trace }),
  };
  if (input.followUp !== undefined)
    return writeFollowUp(gateway, persona, base, followUpBrief(input.followUp), notes.dropped);
  const brain = await gateway.brain({
    ...base,
    ...(input.alerts !== undefined && input.alerts.length > 0 && { alerts: input.alerts }),
  });
  const brief = brain.ok ? brain.value.output : undefined;
  // A trap overrides whatever the brain suggested: she does not play along (agent/domain/traps.ts).
  const trap = assessTrap({
    fanText: input.fanText,
    earlierFanTexts: earlierFanTexts(input.history),
    media: input.media,
    ...(brief && { brain: brief }),
  });
  const read: Brief =
    trap.replyBrief === undefined
      ? (brief ?? NEUTRAL_BRIEF)
      : {
          ...(brief ?? NEUTRAL_BRIEF),
          action: 'reply',
          replyBrief: trap.replyBrief,
          toneHints: [...(trap.toneHints ?? [])],
        };
  // His age as stored: one he states now counts from his next message, so the answer to « j'ai 25 ans » stays
  // careful. The cursor decides from it, a trap's answer first.
  const ageDeclared = brief === undefined ? null : declaredAdultAge(brief.factsProposed, input.fanText);
  // His heat, counted by code from the brain's signals and what it measured (P3-12); read as stored once counted.
  const desire = brief === undefined ? undefined : desireOf(brief, input);
  const heat = desire?.score ?? desireNow(input.desire?.previous, input.situation.now);
  const ageConfirmed = input.sexualization?.ageConfirmed === true;
  const noExplicit = input.sexualization?.noExplicit === true;
  const sexualization =
    brief === undefined
      ? undefined
      : sexualizationDecision({
          relationshipHours:
            (input.situation.now.getTime() - input.situation.relationshipStartedAt.getTime()) / HOUR_MS,
          ageConfirmed,
          noExplicit,
          fanSexualizes: offerSignals(brief).fanSexualizes,
          desire: heat,
          limits: input.sexualization?.limits ?? NO_LIMITS,
        });
  const within =
    sexualization === undefined || trap.replyBrief !== undefined ? read : withinCursor(read, sexualization);
  // She waited once already: no second wait, a light « tu es revenu ? » (P3-11).
  const cursored: Brief =
    input.waited === true && within.action === 'wait'
      ? {
          ...within,
          action: 'reply',
          replyBrief: CAME_BACK_BRIEF,
          toneHints: [...within.toneHints, NO_OPENING_HINT],
        }
      : within;
  // The brain may suggest an offer, only the policy decides (CLAUDE.md rule 3): refused, she just answers.
  const offerRefused = cursored.action === 'offer' ? offerRefusal(cursored, input.offer, heat) : undefined;
  const voiceBrief: Brief =
    offerRefused === undefined ? cursored : { ...cursored, action: 'reply', replyBrief: NO_OFFER_BRIEF };
  const brainCostUsd = brain.ok ? (brain.value.meta.costUsd ?? 0) : 0;
  const brainLatencyMs = brain.ok ? brain.value.meta.latencyMs : 0;
  if (input.skipVoice?.(brief) === true) {
    return {
      ...(trap.isTrap && { trap }),
      ...(notes.dropped.length > 0 && { droppedNotes: notes.dropped }),
      ...(brief && { brief }),
      ...(!brain.ok && { briefFailure: brain.error }),
      ...(sexualization !== undefined && { sexualization }),
      ...(desire !== undefined && desireMoved(desire) && { desire }),
      ...(ageDeclared !== null && { ageDeclared }),
      ...(offerRefused !== undefined && { offerRefused }),
      bubbles: [],
      violations: [],
      isBlocked: true,
      costUsd: brainCostUsd,
      latencyMs: brainLatencyMs,
      isFallback: false,
      isSkipped: true,
    };
  }
  const voiceInput: VoiceInput = { ...base, brief: voiceBrief };
  const voice = await gateway.voice(voiceInput);
  const written = voice.ok ? voice.value.output.bubbles : [];
  // Checked as written: the length and count guards read the voice's bubbles, not the joined message.
  const violations = [
    ...checkVoiceOutput(written, persona.guardSettings, guardContextOf(input.history)),
    ...(ageConfirmed && !noExplicit ? [] : checkExplicit(written)),
  ];
  const bubbles = asSent(written, persona.splitMessages);
  return {
    ...(trap.isTrap && { trap }),
    ...(notes.dropped.length > 0 && { droppedNotes: notes.dropped }),
    ...(brief && { brief }),
    ...(!brain.ok && { briefFailure: brain.error }),
    ...(sexualization !== undefined && { sexualization }),
    ...(desire !== undefined && desireMoved(desire) && { desire }),
    ...(ageDeclared !== null && { ageDeclared }),
    ...(offerRefused !== undefined && { offerRefused }),
    voiceBrief,
    voiceInput,
    bubbles,
    ...(!voice.ok && { voiceFailure: voice.error }),
    violations,
    isBlocked: isBlocked(violations) || !voice.ok,
    costUsd: brainCostUsd + (voice.ok ? (voice.value.meta.costUsd ?? 0) : 0),
    latencyMs: brainLatencyMs + (voice.ok ? voice.value.meta.latencyMs : 0),
    ...(voice.ok && { model: voice.value.meta.model }),
    isFallback: voice.ok && voice.value.meta.isFallback,
  };
}
