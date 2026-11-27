import type {
  CustomPriceGrid,
  FanAvailabilityRecord,
  FanFlags,
  FanTier,
  GuardCode,
  Language,
  LanguageExamples,
  MediaDescription,
  MeetingTierSettings,
  ObjectionReplies,
  OpenCustomOrder,
} from '@impera/contracts';
import type {
  AgencyStyleText,
  BrainAlert,
  Brief,
  CallTrace,
  ConversationTurn,
  LlmFailure,
  VoiceInput,
} from '@impera/llm';

import type { CustomOrderTurn } from '../../custom-orders';
import type { AbandonTease } from '../domain/abandon';
import type { TimeWasterLevel } from '../domain/attention';
import type { ScriptStart } from '../domain/availability';
import type { CustomOrderDecision } from '../domain/custom-order';
import type { DesireMeasure, DesireReading, DesireState } from '../domain/desire';
import type { GuardSettings, GuardViolation } from '../domain/guards';
import type { LanguageDecision } from '../domain/language';
import type { MeetingAnswer, MeetingReason } from '../domain/meeting';
import type { PickedObjectionReply } from '../domain/objections';
import type { SaleTroubleOutcome, SaleTroubleSeen } from '../domain/sale-trouble';
import type { ScriptTurn } from '../domain/script-turn';
import type { SexualizationDecision, SexualizationLimits } from '../domain/sexualization';
import type { Situation } from '../domain/situation';
import type { SpenderRegister } from '../domain/spender-register';
import type { StandingLimits } from '../domain/standing';
import type { TrapAssessment } from '../domain/traps';
import type { AftercareTurn, FollowUpTurn } from '../domain/turn-briefs';
import type { OfferRefusal } from '../domain/turn-sale';
import type { OfferInput, ScriptsInput } from '../domain/turn-scripts';
import type { HerRecentMessage, WornLimits } from '../domain/worn';

import type { VoiceExample } from './calibration-record';

/** The shapes `composeTurn` reads and returns: what the composer, the playground and the evals give it. */

/** Who she is for the models: one persona, read by the composition root. */
export interface ComposerPersona {
  readonly creatorName: string;
  readonly personaSheet: string;
  readonly guardSettings: GuardSettings;
  /** False: her answer goes out as one message (`behavior.split_messages`). Absent: as the voice wrote it. */
  readonly splitMessages?: boolean;
  /**
   * She may play the jealous one when he speaks of another woman (`behavior.plays_jealous`, Charles 27/11). Absent or
   * false: the voice is told she is not jealous.
   */
  readonly playsJealous?: boolean;
  /**
   * Her bio on her platform profile, as last read (ADR 0154): beside her sheet, read as data, it wins where they
   * differ. Absent or empty: no section.
   */
  readonly profileBio?: string | null;
  /**
   * Her bank's examples her hard guards let through, newest first (ADR 0102, `pickVoiceExamples`): each turn gives the
   * voice the twelve this fan may read, added to `personaSheet`, and her voice's call names them in `llm_calls`.
   */
  readonly voiceExamples?: readonly VoiceExample[];
  /** The agency's base style (ADR 0173), before her sheet in the voice's prompt; her sheet wins. Absent: none. */
  readonly agencyStyle?: AgencyStyleText;
  /** When a phrase of hers is worn across her fans (`wornPhrases`); absent, the safe defaults. */
  readonly wornLimits?: WornLimits;
  /**
   * Her languages, in her order (ADR 0168), required: a caller that forgot them once made her answer in French only.
   * `FRENCH_ONLY` for a persona that speaks nothing else.
   */
  readonly spokenLanguages: readonly [Language, ...Language[]];
  /** Her messages per language, given to the voice only in the language it writes in (ADR 0168 § 3). */
  readonly languageExamples: LanguageExamples;
}

/** The languages of a persona that speaks French only. */
export const FRENCH_ONLY: readonly [Language, ...Language[]] = ['french'];

export interface ComposeTurnInput {
  /** The conversation so far, his last message(s) included, oldest first. */
  readonly history: readonly ConversationTurn[];
  /** His kept language (`fans.language`, ADR 0168 § 3); absent or `null`, none yet. */
  readonly keptLanguage?: { readonly value: Language; readonly source: 'detected' | 'set' } | null;
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
   * How close she is with him, chosen by code from his tier (ADR 0132 § 7, `spenderRegisterOf`); absent, warm as with
   * everyone. The brain never reads his tier.
   */
  readonly spenderRegister?: SpenderRegister;
  /** He is a time-waster at this level (ADR 0135 § 7): one short bubble, busy and kind. Absent, he is not. */
  readonly timeWaster?: TimeWasterLevel;
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
   * Her word after a sale of his (ADR 0156 § 2), not an answer: like a follow-up, no brain call, a brief set by code
   * (thanks and tenderness, nothing to buy, nothing explicit), one bubble checked by every guard.
   */
  readonly aftercare?: AftercareTurn;
  /**
   * She already waited once for his last message (« attends, je reviens », P3-11): a brain that would wait again is
   * overruled, she asks him lightly whether he is back.
   */
  readonly waited?: boolean;
  /**
   * Her hours close in a few minutes (`herDayEndsSoon`, ADR 0158 § A 7): her answer is a goodbye for the day, and no
   * step starts that would be cut off.
   */
  readonly herDayEnds?: boolean;
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
    /**
     * His order as the custom-orders module keeps it (ADR 0159 § A.2): given, the turn follows it box by box and the
     * brain reads his request; `null`, none open. Absent, no order is kept and she answers as before (ADR 0090 § A).
     */
    readonly order?: OpenCustomOrder | null;
    /** Her grid in force: its supplements for the brain, its price for her card. `null`: never filled in. */
    readonly grid?: CustomPriceGrid | null;
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
  /** What makes him a time-waster (ADR 0135, guide 26/11), the agency's settings; absent, nobody is one. */
  readonly standingLimits?: StandingLimits;
  /** When he asks to see her (Charles 21/11): the reasons she already gave him (the journal), and her one tease. */
  readonly meeting?: {
    readonly given: readonly MeetingReason[];
    readonly teased: boolean;
  };
  /** Her settings for the meeting tiers (guide 26/11), typed by the owner; absent, nobody goes past the second. */
  readonly meetingTiers?: MeetingTierSettings;
  /**
   * The random source of the draw of a sexting without a sale (Charles 26/11, `freeSextingTurn`): a number in [0, 1).
   * Absent, `Math.random`; a test gives a fixed one.
   */
  readonly random?: () => number;
  /**
   * His tier in « Fans » (`fanTierOf`, the owner's thresholds), when the caller reads it: good, very good or whale makes
   * him eligible to a sexting without a sale as two scripts bought do. Absent: his scripts alone decide.
   */
  readonly fanTier?: FanTier | null;
  /**
   * Her last outgoing messages to all her fans, newest first (passe 2 du 26/11): what comes back in too many of them
   * is worn, and she does not say it again; only what came back to several fans counts (`WORN_MIN_CONVERSATIONS`).
   * Absent: only what she sent him is read.
   */
  readonly herRecent?: readonly HerRecentMessage[];
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
  /** The custom-orders turn, when his order is kept (ADR 0159): what the caller records for it, in the same turn. */
  readonly customOrderTurn?: Exclude<CustomOrderTurn, { kind: 'none' }>;
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
  /** She teased him about the run he left (Charles 20/11): one `script_abandon_teased`, counted against what is due. */
  readonly abandonTeased?: AbandonTease;
  /** What she answered to his asking to see her (Charles 21/11), when the voice wrote: to be journaled, never twice. */
  readonly meetingAnswer?: MeetingAnswer;
  /** What the voice was asked to write: kept for a comparison or a rating. */
  readonly voiceBrief?: Brief;
  readonly voiceInput?: VoiceInput;
  readonly bubbles: readonly string[];
  readonly voiceFailure?: LlmFailure;
  readonly violations: readonly GuardViolation[];
  /** The turn was sexual (her register or her script running): what a voice compared on it is guarded the same way. */
  readonly sexualTurn?: boolean;
  /**
   * A first answer a blocking guard set aside, written again (IA-08): its blocking codes, kept for the human who reads
   * the second one. Absent when the first answer went through.
   */
  readonly retried?: readonly GuardCode[];
  readonly isBlocked: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly model?: string;
  readonly isFallback: boolean;
  /** `skipVoice` stopped it: no voice call was made. */
  readonly isSkipped?: boolean;
  /** Written in the care mode (ADR 0088): a human validates it, whatever her mode. */
  readonly care?: true;
  /** A guard refused her first answer and the voice wrote it once more (M1): the copilot says why (ADR 0141 § 2). */
  readonly rewritten?: true;
  /** The language code decided for this turn (ADR 0168): absent only when a media handed him to a human first. */
  readonly language?: LanguageDecision;
  /**
   * Her bubbles in French for the team, one per bubble that leaves, when she writes in another language (ADR 0168
   * § 9): from the same voice call, never sent, never read by a guard. Absent when none fits.
   */
  readonly translation?: readonly string[];
}
