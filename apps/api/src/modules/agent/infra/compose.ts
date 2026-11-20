import {
  desireNow,
  normalise,
  type FanFlags,
  type MediaDescription,
  type ObjectionReplies,
} from '@impera/contracts';
import type {
  BrainAlert,
  Brief,
  BrainScript,
  CallTrace,
  ConversationTurn,
  LlmFailure,
  LlmGateway,
  VoiceInput,
  VoiceScriptStep,
} from '@impera/llm';
import { BRAIN_SCRIPTS_MAX, brainScriptId } from '@impera/llm';

import {
  asksAvailability,
  availabilityChanged,
  readAvailability,
  scriptStartGate,
  sexualizes,
  type FanAvailabilityRecord,
  type ScriptStart,
  type ScriptStartBlock,
} from '../domain/availability';
import { bubbleBudget, fitBubbles } from '../domain/bubbles';
import { CARE_BRIEF, CARE_TONE_HINTS, checkCare } from '../domain/care';
import { checkNoCommitment, customOrderDecision, type CustomOrderDecision } from '../domain/custom-order';
import {
  desireMoved,
  desireRestOf,
  desireScore,
  NO_MEASURE,
  restedDesire,
  type DesireMeasure,
  type DesireReading,
  type DesireState,
} from '../domain/desire';
import { gapNotes, timingLines } from '../domain/elapsed';
import {
  checkExplicit,
  checkVoiceOutput,
  previousTurnsOf,
  touchesTerm,
  type GuardContext,
  isBlocked,
  type GuardSettings,
  type GuardViolation,
} from '../domain/guards';
import { screenNotes } from '../domain/injection';
import { askableOnly } from '../domain/kyc';
import { pickObjectionReply, type PickedObjectionReply } from '../domain/objections';
import { isOpener } from '../domain/origin';
import { paceHints } from '../domain/pace';
import {
  NO_SALE_RISKS,
  offerDecision,
  offerSignals,
  type OfferBlock,
  type OfferContext,
} from '../domain/policy';
import { refusalMove, type RefusalMove } from '../domain/refusal';
import {
  complainsOfPurchase,
  NO_SALE_TROUBLE,
  saleTroubleOutcome,
  type SaleTroubleOutcome,
  type SaleTroubleSeen,
} from '../domain/sale-trouble';
import {
  paidWaiting,
  permittedScripts,
  scriptStepsHeld,
  type PlatformScriptView,
  type ScriptHistoryView,
  type ScriptRun,
} from '../domain/script-run';
import { scriptTurn, type ScriptTurn } from '../domain/script-turn';
import {
  declaredAdultAge,
  checkWelcome,
  sexualizationDecision,
  type SexualizationDecision,
  type SexualizationLimits,
} from '../domain/sexualization';
import { describeSituation, isNight, type Situation } from '../domain/situation';
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
  /**
   * Her notes the brain reads alone (ADR 0085 § 9: when he has money, his attachment, his moods): added to its notes,
   * never to the voice's, whatever a prompt says.
   */
  readonly brainNotes?: string;
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
  /**
   * The care mode (ADR 0088): true when code already knows (an episode open, his words read by the safety net), or
   * read on the brain's risks. In care, the voice writes the code's care brief, nothing is offered, nothing sexual, and
   * the care guard reads what it wrote; a brain that failed does not stop it when code already knows.
   */
  readonly care?: boolean | ((brief: Brief | undefined) => boolean);
  /**
   * What a custom order of his needs (ADR 0090 § A): whether a chatter is on shift, whether one of his already waits,
   * and his limits. Absent: nobody on shift, none open, his limits unknown; she still commits to nothing.
   */
  readonly customOrder?: {
    readonly chatterOnShift: boolean;
    readonly orderOpen: boolean;
    readonly flags: FanFlags | undefined;
  };
  /** Her replies to a price objection (ADR 0090 § B), and those he already received: never twice. */
  readonly objections?: {
    readonly bank: ObjectionReplies;
    readonly usedReplyIds: ReadonlySet<string>;
  };
  /**
   * Her scripts (ADR 0098): her catalogue, Reveal's history of his, his latest run. Absent, or without `offer`, no
   * script moves and none is decided; a brain's « offer » is then written as before, through the policy.
   */
  readonly scripts?: ScriptsInput;
  /**
   * His availability as the conversation keeps it (ADR 0103, amendement du 13/11); `null` before the first. Read with
   * `offer` (her script threshold): the record follows his message and gates the first teaser.
   */
  readonly availability?: FanAvailabilityRecord | null;
  /**
   * A sale gone wrong (ADR 0156 § 4 and § 7): when she last answered each trouble for him, and whether he ever bought
   * from her. Absent: never answered, nothing bought.
   */
  readonly saleTrouble?: { readonly seen: SaleTroubleSeen; readonly hasBought: boolean };
}

/** What a script decision reads (`scriptTurn`), besides the brain's reading, his heat and the policy's facts. */
export interface ScriptsInput {
  /** The conversation on the platform: the idempotency key of a step names it. */
  readonly conversationRef: string;
  readonly catalogue: readonly PlatformScriptView[];
  /** `null` when it could not be read: nothing moves, nothing sells (ADR 0018 § 5). */
  readonly history: ScriptHistoryView | null;
  readonly latest: ScriptRun | null;
  /** False on a second pass over the same message: it was already counted against the step waiting. */
  readonly countsHisMessage: boolean;
}

/** The scripts the brain may pick from, by the short ids it answers with (`s1`…). */
function scriptChoices(
  scripts: ScriptsInput | undefined,
  situation: Situation,
): readonly { readonly id: string; readonly script: PlatformScriptView }[] {
  if (scripts?.history === undefined || scripts.history === null) return [];
  return permittedScripts(scripts.catalogue, {
    moment: isNight(situation) ? 'night' : 'day',
    history: scripts.history,
  })
    .slice(0, BRAIN_SCRIPTS_MAX)
    .map((script, index) => ({ id: brainScriptId(index), script }));
}

/** The step decided, as the voice's typed block says it: kind, catalogue price, instruction, media (ADR 0098 § 5). */
function voiceStepOf(turn: ScriptTurn | undefined): VoiceScriptStep | undefined {
  const { decision, script } = turn ?? {};
  if (script === undefined || script === null) return undefined;
  if (decision?.kind !== 'start' && decision?.kind !== 'send_step') return undefined;
  const step = script.steps[decision.step.stepIndex];
  if (step === undefined) return undefined;
  return {
    kind: decision.step.kind,
    // Reveal sells in euros: the catalogue's minor units are cents.
    price:
      decision.step.priceMinor === null ? null : { amountMinor: decision.step.priceMinor, currency: 'EUR' },
    instruction: step.instruction ?? null,
    mediaSheet: step.mediaSheet ?? null,
  };
}

/** The step decided sends a media of her vault: the bubbles that bring it may announce it. */
function stepSendsMedia(turn: ScriptTurn | undefined): boolean {
  const { decision, script } = turn ?? {};
  if (script === undefined || script === null) return false;
  if (decision?.kind !== 'start' && decision?.kind !== 'send_step') return false;
  return (script.steps[decision.step.stepIndex]?.mediaRefs.length ?? 0) > 0;
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

/**
 * Why the brain's offer was not written: the policy's reason, nothing to decide on, or, with her scripts read, no step
 * of a script decided (she offers only what a script sends, ADR 0098).
 */
type OfferRefusal = OfferBlock | ScriptStartBlock | 'no_offer_context' | 'no_script_step' | 'he_came';

/** Why her first answer was refused, as the voice reads it once more (M1): the fault, never the words she wrote. */
const REWRITE_REASONS: Partial<Record<GuardViolation['code'], string>> = {
  repetition: 'elle répétait une phrase déjà envoyée',
  explicit_before_age: 'elle était trop explicite pour le moment',
  meeting_promise: 'elle acceptait une rencontre concrète',
  contact_info: 'elle donnait un contact',
  off_platform_payment: 'elle parlait de payer ailleurs',
  price_outside_offer: 'elle écrivait un prix',
  no_commitment: 'elle s’engageait sur sa demande',
  care_breach: 'elle n’était pas assez douce pour ce moment',
  unwarranted_brake:
    'elle le freinait alors qu’il lui faisait un compliment : elle le reçoit avec plaisir et le remercie',
  media_not_sent: 'elle annonçait un média qu’elle n’envoie pas',
  stage_direction: 'elle décrivait un geste entre astérisques ou parenthèses',
};

function rewriteHint(violations: readonly GuardViolation[]): string {
  const blocking = violations.filter((violation) => violation.severity === 'blocking');
  const reasons = [...new Set(blocking.map((violation) => REWRITE_REASONS[violation.code]))].filter(
    (reason) => reason !== undefined,
  );
  return reasons.length === 0
    ? 'sa première réponse a été refusée : réécris-la autrement, plus simple et plus naturelle'
    : `sa première réponse a été refusée (${reasons.join(', ')}) : réécris-la autrement`;
}

/** What the voice writes instead of an offer the policy refused: an answer, nothing to buy. */
const NO_OFFER_BRIEF =
  'Réponds à ce qu’il vient de dire et garde la complicité, sans rien proposer de payant, sans parler de prix ni de contenu à acheter.';

/**
 * He asks for her content and no offer may go now (audit du 16/11, M4): she says yes with desire, keeps the mystery, and
 * promises no date, no price, nothing sent now. Never when a risk forbids any sale: then nothing of her content.
 */
const MEDIA_LATER_BRIEF =
  'Il demande de son contenu : elle lui répond avec envie que oui, elle en a, et garde le mystère, sans rien envoyer ni proposer maintenant, sans prix ni date.';

/** What she answers in place of an offer the policy refused. */
function refusedOfferBrief(brief: Brief): string {
  return brief.intent === 'asks_for_media' && !brief.risks.some((risk) => NO_SALE_RISKS.includes(risk))
    ? MEDIA_LATER_BRIEF
    : NO_OFFER_BRIEF;
}

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
const NO_OPENING_HINT =
  'aucune allusion sexuelle de sa part, elle n’ouvre pas ce terrain ; le flirt et la complicité restent permis';
/** He compliments or flirts, nothing sexual: she welcomes it, never dodges it (Charles, 16/11). */
const FLIRT_HINT =
  'il la complimente ou flirte : elle le reçoit avec plaisir, l’assume et le remercie, taquine, et flirte avec lui en retour, sans allusion sexuelle de sa part ; jamais elle ne le freine ni ne lui dit qu’il va trop vite ou trop fort';

// She asked his age already in this conversation: « t'as quel âge ? », « tu as quel âge », « et ton âge ? ».
const ASKED_AGE = /\b(?:quel age|ton age|age as[- ]tu|age t'?as)\b/u;

/** She asked his age already: she never asks it twice in a conversation (audit du 16/11, C2). */
function askedHisAge(history: readonly ConversationTurn[]): boolean {
  return history.some((turn) => turn.from === 'creator' && ASKED_AGE.test(normalise(turn.text)));
}
/** He is hot and sexualizes, only his availability is unknown: she makes sure in passing, once (ADR 0103 § 13). */
const ASK_AVAILABILITY_HINT =
  'en passant, elle s’assure qu’il est tranquille (seul, chez lui, pas pressé), naturellement, sans rien proposer';
const SUGGESTIVE_HINT = 'suggestive seulement, jamais explicite';
/** He came back without opening the paid step she sent: she teases him about it once (ADR 0156 § 1). */
const UNOPENED_STEP_HINT =
  'en passant, une seule fois, elle le taquine gentiment parce qu’il n’a pas ouvert ce qu’elle lui avait envoyé, sans insister, sans reproche, sans prix ni nouvelle proposition ; elle répond d’abord à ce qu’il dit';

/**
 * He complains about what he bought (ADR 0156 § 7, ADR 0158 § 48): she wants to understand, gives nothing for free,
 * and sends him to Reveal for a refund. Said again soon after, a human answers.
 */
const PURCHASE_COMPLAINT_HINT =
  'il se plaint de ce qu’il a acheté : elle lui demande gentiment ce qui ne lui a pas plu et ce qu’il aurait aimé, sans se justifier ni rien offrir en échange ; s’il veut être remboursé, il peut le demander à Reveal ; rien à vendre';

/**
 * He says goodbye (ADR 0158 § A): goodnight, or he has to go. She answers with a goodbye, one bubble, in her
 * own way: no question that would keep him, nothing to sell. Her next follow-up waits (`farewellNotBefore`).
 */
const FAREWELL_HINTS = {
  says_goodnight:
    'il va se coucher : elle lui souhaite bonne nuit à sa façon, en une seule bulle, tendre ou taquine, sans question ni rien proposer',
  away: 'il doit y aller : elle le laisse filer à sa façon, en une seule bulle, sans question ni rien proposer, contente de le retrouver plus tard',
} as const;

function farewellOf(signals: readonly string[] | undefined): keyof typeof FAREWELL_HINTS | null {
  const read = signals ?? [];
  if (read.includes('says_goodnight')) return 'says_goodnight';
  // « Je suis au boulot » while he keeps writing is no goodbye: `busy_now` only spaces her follow-up.
  return read.includes('leaving_soon') ? 'away' : null;
}

/**
 * He just came (ADR 0156 § 6): she shares the moment with him, tender and proud, and the evening's sale stops there.
 * His run pauses; no step, no offer, no question that would start the game again.
 */
const HE_CAME_HINT =
  'il vient de jouir : elle savoure ce moment avec lui, tendre, fière et complice, en une ou deux bulles ; rien à vendre, aucune nouvelle demande, pas de question pour relancer le jeu';

/** He asks how to pay for her step waiting (ADR 0156 § 4): she helps him plainly, the price in the voice's block. */
const PAYMENT_HELP_HINT =
  'il veut ouvrir ce qu’elle lui a envoyé et ne sait pas comment : elle l’aide simplement et gentiment, avec le prix exact du bloc, sans le presser ni rien proposer d’autre';

/**
 * The paid step waiting for him, as the voice reads it to help him open it (ADR 0156 § 4): its exact price and what
 * it holds. Never when its price changed on the catalogue (he would pay another one), nor once no sale is allowed.
 */
function waitingStepOf(turn: ScriptTurn, catalogue: readonly PlatformScriptView[], scriptRef: string | null) {
  const { decision } = turn;
  if (decision.kind !== 'wait' || !('step' in decision) || turn.priceMismatch !== null) return undefined;
  const { priceMinor, stepIndex } = decision.step;
  if (priceMinor === null) return undefined;
  const step = catalogue.find((script) => script.scriptRef === scriptRef)?.steps[stepIndex];
  return {
    // Reveal sells in euros: the catalogue's minor units are cents.
    price: { amountMinor: priceMinor, currency: 'EUR' as const },
    mediaSheet: step?.mediaSheet ?? null,
  };
}

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

/**
 * Her move after he refused a paid step (ADR 0156 § 3), decided by code: never a price nor a new offer, never a
 * reproach. The sulk is playful, the méthode's and Charles's (16/11): what she feels, never his fault.
 */
const REFUSAL_HINTS: Readonly<Record<RefusalMove, string>> = {
  ask_why:
    'il vient de dire non à ce qu’elle lui proposait : elle le prend bien, sans reproche, et lui demande avec curiosité ce qui ne lui a pas plu, sans prix ni nouvelle proposition',
  insist:
    'elle insiste un tout petit peu, une seule fois, avec légèreté, en rebondissant sur ce qu’il a dit, sans prix, sans pression ni reproche',
  sulk: 'elle boude un peu pour jouer, une bulle courte, un brin vexée, jamais de reproche ni de culpabilisation, puis elle passe à autre chose',
};

/** Her answers since the run ended: which move of the refusal comes next. */
function herAnswersSince(history: readonly ConversationTurn[], since: Date | null): number {
  if (since === null) return 0;
  return history.filter((turn) => turn.from === 'creator' && turn.at !== undefined && turn.at >= since)
    .length;
}

/** What the voice writes when she waited for him once and he has not written since (P3-11), set by code. */
const CAME_BACK_BRIEF =
  'Il lui avait dit d’attendre un peu et n’a rien écrit depuis. Elle lui demande avec légèreté s’il est revenu, en une phrase, sans reproche, sans rien proposer de payant.';

/** What the voice writes in the care mode: the code's brief, whatever the brain or a trap suggested (ADR 0088 § 3). */
function careBrief(read: Brief): Brief {
  return { ...read, action: 'reply', replyBrief: CARE_BRIEF, toneHints: [...CARE_TONE_HINTS] };
}

/**
 * The brief as the cursor lets the voice write it. His age is asked at most once, and never right after he gave it
 * (`ageAsked`): she slows down without asking it again. A flirt she may not take further is still welcomed.
 */
function withinCursor(brief: Brief, decision: SexualizationDecision, ageAsked: boolean): Brief {
  if (decision.kind === 'steer_back') {
    const reason = decision.reason === 'age_unconfirmed' && ageAsked ? 'too_early' : decision.reason;
    return { ...brief, action: 'reply', replyBrief: STEER_BACK_BRIEF[reason] };
  }
  if (decision.kind === 'no_opening')
    return {
      ...brief,
      toneHints: [...brief.toneHints, ...(brief.intent === 'flirt' ? [FLIRT_HINT] : []), NO_OPENING_HINT],
    };
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
  /** His desire score read on this message, moved or not: the playground shows it to calibrate the counting. */
  readonly desireRead?: DesireReading;
  /** An adult age he stated himself in this message (`declaredAdultAge`): the composer may confirm his age. */
  readonly ageDeclared?: number;
  /** The brain suggested an offer and the policy refused it: the voice wrote a plain answer. */
  readonly offerRefused?: OfferRefusal;
  /** He asked for a custom order (ADR 0090 § A): a chatter takes it, or she answered committing to nothing. */
  readonly customOrder?: Exclude<CustomOrderDecision, { kind: 'none' }>;
  /** The reply of her bank the voice was given for his price objection (ADR 0090 § B). */
  readonly objectionReply?: PickedObjectionReply;
  /** Her scripts at this message (ADR 0098): the run moved or opened, the step decided, a price that changed. */
  readonly scripts?: ScriptTurn;
  /**
   * His availability after this message (ADR 0103): the record, and whether it changed (only then is it journaled).
   * Absent without the brain's reading or her script threshold.
   */
  readonly availability?: { readonly record: FanAvailabilityRecord; readonly changed: boolean };
  /** The gate before the first teaser at this message: open, or the conditions missing (ADR 0103 § 11). */
  readonly scriptStart?: ScriptStart;
  /** A sale gone wrong at this message: she answers it, or the same trouble again goes to a human (ADR 0156). */
  readonly saleTrouble?: SaleTroubleOutcome;
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
  /** Written in the care mode (ADR 0088): a human validates it, whatever her mode. */
  readonly care?: true;
}

/** Answers the team corrected in the playground, given to the voice as her examples (they take precedence). */
export function withExamples(sheet: string, examples: readonly string[]): string {
  if (examples.length === 0) return sheet;
  return `${sheet}\n\nExemples de ses messages, corrigés par l'équipe :\n${examples.map((e) => `- ${e}`).join('\n')}`;
}

/**
 * What her guards read the draft against (P3-13): a draft carries a media only through the step of her script that
 * leaves with it (ADR 0098), and her last turns are in the history.
 */
export function guardContextOf(
  history: readonly ConversationTurn[],
  hasMedia = false,
  allowedPriceMinor?: number,
): GuardContext {
  return {
    hasMedia,
    ...(allowedPriceMinor !== undefined && { allowedPriceMinor }),
    previousTurns: previousTurnsOf(
      history.map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })),
    ),
    sentBefore: history.filter((turn) => turn.from === 'creator').map((turn) => turn.text),
  };
}

const datedOf = (turn: ConversationTurn) => ({
  fromFan: turn.from === 'fan',
  ...(turn.at !== undefined && { at: turn.at }),
});

/** « Le moment », with what code reads of the last exchanges' times (audit du naturel, A2). */
function describeMoment(situation: Situation, history: readonly ConversationTurn[]): string {
  // Her messages an automation wrote (ADR 0110 § 3): said once here, never as a bracket in her own turn.
  const automated = new Set(
    history.flatMap((turn) =>
      turn.from === 'creator' && turn.originNote !== undefined ? [turn.originNote] : [],
    ),
  );
  return [
    describeSituation(situation),
    ...timingLines(history.map(datedOf), situation.now),
    ...automated,
  ].join('\n');
}

/** Each message of his after a silence carries the time that passed, written by code on her clock. */
function withTimeNotes(history: readonly ConversationTurn[], timeZone: string): readonly ConversationTurn[] {
  const notes = gapNotes(history.map(datedOf), timeZone);
  return history.map((turn, index) => {
    const timeNote = notes[index];
    return timeNote === null || timeNote === undefined ? turn : { ...turn, timeNote };
  });
}

/** His messages before the ones she is answering: the history without its last run of fan turns. */
function earlierFanTexts(history: readonly ConversationTurn[]): string[] {
  let end = history.length;
  while (end > 0 && history[end - 1]?.from === 'fan') end -= 1;
  return history
    .slice(0, end)
    .filter((turn) => turn.from === 'fan' && !isOpener(turn))
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
  // A follow-up: nothing of his awaits, one bubble.
  const voiceInput: VoiceInput = { ...base, brief, maxBubbles: 1 };
  const voice = await gateway.voice(voiceInput);
  const written = voice.ok ? fitBubbles(voice.value.output.bubbles, 1) : [];
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
    hasBought: input.situation.spentCents > 0,
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
  // The voice's notes are the shared ones only: what is the brain's alone never reaches its prompt (ADR 0085 § 9).
  const base = {
    creatorName: persona.creatorName,
    personaSheet: persona.personaSheet,
    fanNotes: notes.kept,
    situation: describeMoment(input.situation, input.history),
    history: withTimeNotes(input.history, input.situation.timeZone),
    ...(input.trace !== undefined && { trace: input.trace }),
  };
  if (input.followUp !== undefined)
    return writeFollowUp(gateway, persona, base, followUpBrief(input.followUp), notes.dropped);
  const brainOnly = screenNotes(input.brainNotes ?? '');
  const droppedNotes = [...notes.dropped, ...brainOnly.dropped];
  const choices = scriptChoices(input.scripts, input.situation);
  const brainScripts: BrainScript[] = choices.map(({ id, script }) => ({
    id,
    description: script.description,
  }));
  const latestRun = input.scripts?.latest ?? null;
  const stepWaiting = latestRun?.status === 'open' && paidWaiting(latestRun) !== undefined;
  const brain = await gateway.brain({
    ...base,
    fanNotes: [notes.kept, brainOnly.kept].filter((block) => block !== '').join('\n'),
    ...(input.alerts !== undefined && input.alerts.length > 0 && { alerts: input.alerts }),
    ...(brainScripts.length > 0 && { scripts: brainScripts }),
    ...(stepWaiting && { scriptStepWaiting: true }),
  });
  // She asks only what the card lets her ask (ADR 0085 § 2): whatever the brain names, `desires` is never asked.
  const brief = brain.ok ? askableOnly(brain.value.output) : undefined;
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
  // His age: one he states now confirms it at once (Charles, 16/11), no doubt by default and no question again. The
  // cursor decides from it, a trap's answer first.
  const ageDeclared = brief === undefined ? null : declaredAdultAge(brief.factsProposed, input.fanText);
  // His heat, counted by code from the brain's signals and what it measured (P3-12); read as stored once counted.
  const counted = brief === undefined ? undefined : desireOf(brief, input);
  const heat = counted?.score ?? desireNow(input.desire?.previous, input.situation.now);
  const ageConfirmed = input.sexualization?.ageConfirmed === true || ageDeclared !== null;
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
    sexualization === undefined || trap.replyBrief !== undefined
      ? read
      : withinCursor(read, sexualization, ageDeclared !== null || askedHisAge(input.history));
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
  // The care mode (ADR 0088) comes before any sale: no custom order, no objection reply, no script step.
  const care = typeof input.care === 'function' ? input.care(brief) : input.care === true;
  // A custom order is never sold by her (ADR 0090 § A): a chatter takes it, or she commits to nothing. A trap's
  // answer comes first, and in the care mode nothing is sold at all (ADR 0088 § 2).
  const order =
    brief === undefined || trap.replyBrief !== undefined || care
      ? undefined
      : customOrderDecision({
          asksForService: brief.intent === 'asks_for_service',
          chatterOnShift: input.customOrder?.chatterOnShift === true,
          orderOpen: input.customOrder?.orderOpen === true,
          risks: brief.risks,
          flags: input.customOrder?.flags,
          ageConfirmed: ageConfirmed || input.customOrder?.flags?.ageConfirmedAt !== undefined,
          neverDoes: (persona.guardSettings.neverDo ?? []).some((term) => touchesTerm(input.fanText, term)),
        });
  const customOrder = order?.kind === 'none' ? undefined : order;
  // His price objection: a reply of her bank he never received, said in her words (ADR 0090 § B).
  const objectionReply =
    !care &&
    brief?.intent === 'price_objection' &&
    trap.replyBrief === undefined &&
    input.objections !== undefined
      ? pickObjectionReply(input.objections.bank, brief.objection, input.objections.usedReplyIds)
      : undefined;
  // His availability and the gate before the first teaser (ADR 0103 § 9-13): code holds both, the brain only reports.
  const threshold = input.offer?.limits.minDesire;
  const availability =
    brief === undefined || threshold === undefined
      ? undefined
      : readAvailability({
          previous: input.availability ?? null,
          signals: brief.desireSignals ?? [],
          sexualizes: sexualizes(brief),
          desire: heat,
          threshold,
          now: input.situation.now,
        });
  const scriptStart =
    availability === undefined || threshold === undefined
      ? undefined
      : scriptStartGate(availability, heat, threshold);
  const heCame = brief?.desireSignals?.includes('just_came') === true;
  // Her scripts: the run follows his message and Reveal, and code decides the step and its price (ADR 0098).
  const scripts =
    input.scripts === undefined || input.offer === undefined
      ? undefined
      : scriptTurn({
          now: input.situation.now,
          conversationRef: input.scripts.conversationRef,
          latest: input.scripts.latest,
          catalogue: input.scripts.catalogue,
          history: input.scripts.history,
          moment: isNight(input.situation) ? 'night' : 'day',
          hotSession: heat >= input.offer.limits.minDesire,
          // Only an id it was given: anything else picks nothing.
          brainPick: choices.find(({ id }) => id === brief?.scriptPick)?.script.scriptRef ?? null,
          offer: {
            ...input.offer,
            desire: heat,
            fanAsksForPaid: brief !== undefined && offerSignals(brief).fanAsksForPaid,
            risks: brief?.risks ?? [],
          },
          // In care, the run still follows his message and Reveal, and no step goes (ADR 0088 § 2).
          careMode: care,
          ...(scriptStart !== undefined && { startGate: scriptStart }),
          ...(availability !== undefined && { availability: availability.state }),
          reply: brief?.scriptReply ?? null,
          countsHisMessage: input.scripts.countsHisMessage && brief !== undefined,
          heCame,
          mayAct:
            !care &&
            !heCame &&
            brief !== undefined &&
            trap.replyBrief === undefined &&
            customOrder === undefined &&
            objectionReply === undefined &&
            sexualization?.kind !== 'steer_back',
        });
  const scriptStep = voiceStepOf(scripts);
  // He just bought the last step of a script: whether he says so or not, he came, and his score comes back to his rest
  // level (ADR 0156 § 6, Charles 20/11).
  const boughtOut = [scripts?.moved, scripts?.followed].some(
    (change) =>
      change?.run.status === 'bought_out' && change.events.some((event) => event.type === 'script_ended'),
  );
  const desire = counted !== undefined && boughtOut ? restedDesire(counted, desireRestOf(true)) : counted;
  // The brain may suggest an offer, only the policy decides (CLAUDE.md rule 3): refused, she just answers. With her
  // scripts read, she offers only the step code decided.
  const offerRefused =
    cursored.action !== 'offer' || scriptStep !== undefined
      ? undefined
      : heCame
        ? 'he_came'
        : input.scripts !== undefined && input.offer !== undefined
          ? 'no_script_step'
          : scriptStart !== undefined && !scriptStart.open
            ? (scriptStart.missing[0] ?? 'availability_unconfirmed')
            : offerRefusal(cursored, input.offer, heat);
  const decidedBrief: Brief =
    scriptStep === undefined
      ? cursored
      : { ...cursored, action: scriptStep.kind === 'paid' ? 'offer' : 'reply' };
  const offered: Brief =
    offerRefused === undefined
      ? decidedBrief
      : { ...cursored, action: 'reply', replyBrief: refusedOfferBrief(cursored) };
  const answered: Brief = care
    ? careBrief(read)
    : customOrder?.kind === 'reply'
      ? {
          ...offered,
          action: 'reply',
          replyBrief: customOrder.brief,
          toneHints: [...offered.toneHints, NO_OPENING_HINT],
        }
      : offered;
  const asking =
    !care &&
    availability !== undefined &&
    scriptStart !== undefined &&
    asksAvailability(availability, scriptStart) &&
    scriptStep === undefined &&
    customOrder === undefined &&
    objectionReply === undefined &&
    trap.replyBrief === undefined &&
    sexualization?.kind !== 'steer_back';
  // Getting to know him at his pace, never a questionnaire (Playground, Charles 16/11): on an ordinary answer only.
  const paced =
    !care &&
    !asking &&
    answered.action === 'reply' &&
    scriptStep === undefined &&
    customOrder === undefined &&
    objectionReply === undefined &&
    trap.replyBrief === undefined &&
    sexualization?.kind !== 'steer_back'
      ? paceHints(
          input.fanText,
          previousTurnsOf(
            input.history
              .filter((turn) => !isOpener(turn))
              .map((turn) => ({ fromFan: turn.from === 'fan', text: turn.text })),
          ),
        )
      : [];
  // He just said no to her paid step: she asks why, insists once, sulks once at most, then lets go (ADR 0156 § 3).
  const refusal =
    care ||
    scripts === undefined ||
    input.offer === undefined ||
    scriptStep !== undefined ||
    customOrder !== undefined ||
    objectionReply !== undefined ||
    trap.replyBrief !== undefined ||
    sexualization?.kind === 'steer_back'
      ? null
      : scripts.decision.kind === 'after_refusal'
        ? 'ask_why'
        : refusalMove({
            now: input.situation.now,
            run: input.scripts?.latest ?? null,
            herAnswersSince: herAnswersSince(input.history, input.scripts?.latest?.endedAt ?? null),
            flags: input.offer.flags,
            care,
          });
  // He comes back after the session cooled, her paid step unopened: one light reminder, never a sale (ADR 0156 § 1).
  const reminds =
    !care &&
    scripts?.decision.kind === 'end' &&
    scripts.decision.unopened !== undefined &&
    customOrder === undefined &&
    objectionReply === undefined &&
    trap.replyBrief === undefined &&
    sexualization?.kind !== 'steer_back';
  // He asks how to pay for her step waiting: the voice sees its exact price and what it holds (ADR 0156 § 4). Every
  // stop of a sale holds: no help to buy for a fan nobody may sell to.
  const waitingStepFound =
    brief?.intent !== 'payment_help' ||
    care ||
    scripts === undefined ||
    input.scripts === undefined ||
    input.offer === undefined ||
    scriptStepsHeld(input.offer.flags, care) ||
    !offerDecision({ ...input.offer, desire: heat, fanAsksForPaid: true, risks: brief.risks }).allowed ||
    customOrder !== undefined ||
    trap.replyBrief !== undefined
      ? undefined
      : waitingStepOf(scripts, input.scripts.catalogue, input.scripts.latest?.scriptRef ?? null);
  // A sale gone wrong (ADR 0156 § 4 and § 7): she answers it once; the same trouble again soon after goes to a human.
  const troubleSeen = input.saleTrouble?.seen ?? NO_SALE_TROUBLE;
  const saleTrouble: SaleTroubleOutcome | undefined =
    waitingStepFound !== undefined
      ? saleTroubleOutcome('payment_help', troubleSeen, input.situation.now)
      : brief !== undefined &&
          !care &&
          complainsOfPurchase({
            intent: brief.intent,
            risks: brief.risks,
            hasBought: input.saleTrouble?.hasBought === true,
          })
        ? saleTroubleOutcome('purchase_complaint', troubleSeen, input.situation.now)
        : undefined;
  // Still stuck after her help: a human answers, she does not explain the same thing twice.
  const waitingStep = saleTrouble?.kind === 'handoff' ? undefined : waitingStepFound;
  const complaint = saleTrouble?.kind === 'answer' && saleTrouble.trouble === 'purchase_complaint';
  // He leaves: a goodbye, unless she brings or helps him open a step (his own words then lead).
  const farewell =
    scriptStep === undefined && waitingStep === undefined ? farewellOf(brief?.desireSignals) : null;
  const voiceBrief: Brief =
    heCame && !care
      ? {
          ...answered,
          toneHints: [
            ...answered.toneHints,
            HE_CAME_HINT,
            ...(farewell === null ? [] : [FAREWELL_HINTS[farewell]]),
          ],
        }
      : farewell !== null
        ? { ...answered, toneHints: [...answered.toneHints, FAREWELL_HINTS[farewell]] }
        : asking
          ? { ...answered, toneHints: [...answered.toneHints, ASK_AVAILABILITY_HINT] }
          : {
              ...answered,
              toneHints: [
                ...answered.toneHints,
                ...paced,
                ...(reminds ? [UNOPENED_STEP_HINT] : []),
                ...(waitingStep === undefined ? [] : [PAYMENT_HELP_HINT]),
                ...(complaint ? [PURCHASE_COMPLAINT_HINT] : []),
                ...(refusal === null ? [] : [REFUSAL_HINTS[refusal]]),
              ],
            };
  const availabilityOut = (record: FanAvailabilityRecord | undefined) =>
    record === undefined
      ? {}
      : {
          availability: { record, changed: availabilityChanged(input.availability ?? null, record) },
          ...(scriptStart !== undefined && { scriptStart }),
        };
  const brainCostUsd = brain.ok ? (brain.value.meta.costUsd ?? 0) : 0;
  const brainLatencyMs = brain.ok ? brain.value.meta.latencyMs : 0;
  if (
    input.skipVoice?.(brief) === true ||
    customOrder?.kind === 'handoff' ||
    saleTrouble?.kind === 'handoff'
  ) {
    return {
      ...(customOrder !== undefined && { customOrder }),
      ...(saleTrouble !== undefined && { saleTrouble }),
      ...(scripts !== undefined && { scripts }),
      ...availabilityOut(availability),
      ...(trap.isTrap && { trap }),
      ...(droppedNotes.length > 0 && { droppedNotes }),
      ...(brief && { brief }),
      ...(!brain.ok && { briefFailure: brain.error }),
      ...(sexualization !== undefined && { sexualization }),
      ...(desire !== undefined && desireMoved(desire) && { desire }),
      ...(desire !== undefined && { desireRead: desire }),
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
  const budget = farewell === null ? bubbleBudget(input.history) : 1;
  const voiceInput: VoiceInput = {
    ...base,
    brief: voiceBrief,
    maxBubbles: budget,
    ...(objectionReply !== undefined && { objectionReply: objectionReply.text }),
    ...(scriptStep !== undefined && { scriptStep }),
    ...(waitingStep !== undefined && { waitingStep }),
  };
  // The one price she may write: the paid step she brings, or the one waiting he asks how to open (ADR 0156 § 4).
  const allowedPriceMinor = scriptStep?.price?.amountMinor ?? waitingStep?.price.amountMinor;
  // Past the budget, left out, never glued nor sent at once (Charles 16/11 : « trois rarement »). Checked as kept:
  // the guards read the bubbles that leave.
  const attempt = async (asked: VoiceInput) => {
    const voice = await gateway.voice(asked);
    const written = voice.ok ? fitBubbles(voice.value.output.bubbles, budget) : [];
    const violations = [
      ...checkVoiceOutput(
        written,
        persona.guardSettings,
        guardContextOf(input.history, stepSendsMedia(scripts), allowedPriceMinor),
      ),
      ...(ageConfirmed && !noExplicit && !care ? [] : checkExplicit(written)),
      ...(care ? checkCare(written) : []),
      ...(customOrder === undefined ? [] : checkNoCommitment(written)),
      // He did not go there and she does not open it: she welcomes him, never slows him down (Charles, 20/11). Once the
      // intimate is open, « pas si vite 😏 » is a tease of hers (relecture Bilan de #876).
      ...(sexualization?.kind === 'no_opening' && !care ? checkWelcome(written) : []),
    ];
    return { voice, written, violations };
  };
  const first = await attempt(voiceInput);
  // A guard blocked her answer: the voice writes it once more, told what was wrong, before a human is called (audit
  // du 16/11, M1). The second answer is read by the same guards; still blocked, a human answers.
  const retried =
    first.voice.ok && isBlocked(first.violations)
      ? await attempt({
          ...voiceInput,
          brief: { ...voiceBrief, toneHints: [...voiceBrief.toneHints, rewriteHint(first.violations)] },
        })
      : undefined;
  const { voice, written, violations } = retried ?? first;
  const firstCostUsd = retried !== undefined && first.voice.ok ? (first.voice.value.meta.costUsd ?? 0) : 0;
  const bubbles = asSent(written, persona.splitMessages);
  return {
    ...(customOrder !== undefined && { customOrder }),
    ...(objectionReply !== undefined && { objectionReply }),
    ...(scripts !== undefined && { scripts }),
    // She asked only if the voice wrote: a question never written is asked again.
    ...availabilityOut(
      availability !== undefined && asking && voice.ok
        ? { ...availability, askedAt: input.situation.now }
        : availability,
    ),
    ...(trap.isTrap && { trap }),
    ...(droppedNotes.length > 0 && { droppedNotes }),
    ...(brief && { brief }),
    ...(!brain.ok && { briefFailure: brain.error }),
    ...(sexualization !== undefined && { sexualization }),
    ...(desire !== undefined && desireMoved(desire) && { desire }),
    ...(desire !== undefined && { desireRead: desire }),
    ...(ageDeclared !== null && { ageDeclared }),
    ...(offerRefused !== undefined && !care && { offerRefused }),
    ...(care && { care: true }),
    ...(saleTrouble !== undefined && { saleTrouble }),
    voiceBrief,
    voiceInput,
    bubbles,
    ...(!voice.ok && { voiceFailure: voice.error }),
    violations,
    isBlocked: isBlocked(violations) || !voice.ok,
    costUsd: brainCostUsd + firstCostUsd + (voice.ok ? (voice.value.meta.costUsd ?? 0) : 0),
    latencyMs: brainLatencyMs + (voice.ok ? voice.value.meta.latencyMs : 0),
    ...(voice.ok && { model: voice.value.meta.model }),
    isFallback: voice.ok && voice.value.meta.isFallback,
  };
}
