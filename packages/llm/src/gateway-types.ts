import type {
  CaptionProposals,
  CommentOutcome,
  CommentPromptInput,
  DropMediaDescription,
  FanCardRead,
  FanFlags,
  Language,
  LlmPurpose,
  MediaDescription,
  Money,
  Result,
  ScriptDropSummary,
  ScriptIdentityContent,
  ScriptStepKind,
  TrendCaptureDescription,
} from '@impera/contracts';
import type { TranscriptionModel } from 'ai';

import type { BudgetEvent } from './budget';
import type { CallOutcome, LlmCallLog } from './call-log';
import type { ApiKeys, LlmConfig, ProviderId } from './config';
import type { HealthReport } from './health';
import type { PromptTemplate } from './prompts';
import type { ModelResolver } from './providers';
import type {
  Brief,
  ChannelPollOutput,
  ChannelPostOutput,
  JudgeCriterion,
  JudgeOutput,
  VoiceOutput,
} from './schemas';

/** A media exchanged in the conversation, already described by `sense`. */
export interface TurnMedia {
  readonly description: MediaDescription;
  /** A paid media of hers the fan has not bought yet: she can tease it, not give it away. */
  readonly isLocked?: boolean;
}

export interface ConversationTurn {
  readonly from: 'fan' | 'creator';
  readonly text: string;
  readonly media?: readonly TurnMedia[];
  /** When it was written; absent where no clock runs (some evals), and nothing is said of the time then. */
  readonly at?: Date;
  /**
   * The time that passed before this message of his, written by code on her clock (« le lendemain, mardi, 19 h 10 »):
   * shown in brackets before his block, never inside it.
   */
  readonly timeNote?: string;
  /**
   * What an automation of the platform wrote, or what his message answers (ADR 0110), written by code: on his turn,
   * shown in brackets before his block; on hers, read into « le moment » by the agent, never shown in her turn.
   */
  readonly originNote?: string;
}

export interface VideoFrame {
  readonly atS: number;
  readonly mediaType: string;
  readonly data: Uint8Array;
}

export type SenseMedia =
  | { readonly kind: 'image'; readonly mediaType: string; readonly data: Uint8Array }
  | {
      readonly kind: 'video';
      readonly durationS: number;
      /** The file, read natively (picture and sound) by a model that takes video, such as Gemini. */
      readonly mediaType: string;
      /** `null` when it is too heavy to be sent whole: only its keyframes are read (ADR 0083, a drop up to 10 Gio). */
      readonly data: Uint8Array | null;
      /**
       * Dated keyframes and transcript, for a model that reads images only (Grok). Called only when the call
       * falls back to such a model, at most once: a fan's video costs ffmpeg and speech to text only then.
       */
      readonly keyframes: () => Promise<VideoKeyframes>;
    }
  | { readonly kind: 'audio'; readonly durationS: number; readonly transcript: string };

export interface VideoKeyframes {
  readonly frames: readonly VideoFrame[];
  /** What is said in it, from `transcribe`. */
  readonly transcript?: string;
}

/** Ties a call to what it was for, so the journal can sum the cost per conversation. */
export interface CallTrace {
  /** The creator whose fan the call answers; none for the playground. */
  readonly creatorId?: string;
  readonly conversationId?: string;
  readonly draftId?: string;
  /**
   * `trend_watch` for a call of the trend watch: refused at its own cap as well as at the daily one (ADR 0060 § 7).
   * Absent is `chatting`, which only the daily cap stops.
   */
  readonly purpose?: LlmPurpose;
  /** A voice call only: the ids of her examples it received (ADR 0102 § 6), to know which correction weighed. */
  readonly voiceExampleIds?: readonly string[];
}

export interface SenseInput {
  /** A fan's media is described to react to it; one of hers, to talk about it and make him want it. */
  readonly origin: 'fan' | 'creator';
  readonly media: SenseMedia;
  readonly trace?: CallTrace;
}

/**
 * A photo or a video she dropped (ADR 0083): described alone, in detail, with what the code knows of its drop. Never
 * any other media of the drop, nor their descriptions: a description that cannot see them cannot point to them.
 */
export interface DropSenseInput {
  readonly media: Exclude<SenseMedia, { readonly kind: 'audio' }>;
  readonly context: DropContext;
  /** Always a `media` call: its purpose is set by the gateway (ADR 0091 § 8). */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/** What the code knows of a drop, given to the model as data. */
export interface DropContext {
  /** Her category, as her screen names it (« Feed · Séance boudoir », « Script »). */
  readonly category: string;
  /** For a script: its step and the media's place in it. */
  readonly step: {
    readonly number: number;
    readonly name: string;
    /** The step's instruction on its card, as the agency wrote it; `null` when it has none. */
    readonly instruction: string | null;
    /** 1 for the step's first media. */
    readonly position: number;
    readonly count: number;
  } | null;
}

export interface ConversationInput {
  readonly creatorName: string;
  /** Persona sections relevant to this turn, already rendered as text. */
  readonly personaSheet: string;
  /** What she knows about this fan; derived from the fan, so treated as untrusted. */
  readonly fanNotes: string;
  /** Her bio on her platform profile, as last read (ADR 0154); none or empty: no section. */
  readonly profileBio?: string | null;
  /** Her local time, day or night, how long they have known each other: written by code, trusted. */
  readonly situation?: string;
  readonly history: readonly ConversationTurn[];
  readonly trace?: CallTrace;
}

/** One of her own alerts, as the brain reads it (P4-01): the id it answers with, the phrase she wrote. */
export interface BrainAlert {
  readonly id: string;
  readonly phrase: string;
}

/**
 * His custom request as the brain reads it (ADR 0159 § A.2): whether one of his is open, and the supplements of her
 * grid it may name, each by the id it answers with and the name the owner gave it.
 */
export interface BrainCustomOrder {
  readonly open: boolean;
  readonly supplements: readonly { readonly id: string; readonly name: string }[];
}

/** A script she may open with him, as the brain reads it (ADR 0098 § 6): the id it answers with, what it is about. */
export interface BrainScript {
  readonly id: string;
  readonly description: string;
  /**
   * What of his desire map the script meets (Charles 26/11, `rankByFantasy`), in his own words; absent or empty, none.
   * The scripts come closest to his fantasy first: the order is code's.
   */
  readonly matches?: readonly string[];
}

export interface BrainInput extends ConversationInput {
  /** Her alerts written as a phrase, at most `BRAIN_ALERTS_MAX`; absent or empty, none is read. */
  readonly alerts?: readonly BrainAlert[];
  /** The scripts code permits now, at most `BRAIN_SCRIPTS_MAX`; absent or empty, the brain picks none. */
  readonly scripts?: readonly BrainScript[];
  /** A step of a script waits for his answer: the brain reads what his last message does with it (`scriptReply`). */
  readonly scriptStepWaiting?: boolean;
  /** His custom request, for `customOrder`; absent, the brain reads one only when he asks for one, with no supplement. */
  readonly customOrder?: BrainCustomOrder;
}

/**
 * The script step code decided to send now (ADR 0098 § 5), for the voice to say: its kind, the price from the
 * catalogue (never the model's), the agency's instruction and the media's sheet when the catalogue has them.
 */
export interface VoiceScriptStep {
  readonly kind: ScriptStepKind;
  /** A paid step only. */
  readonly price: Money | null;
  readonly instruction: string | null;
  readonly mediaSheet: string | null;
  /**
   * How he buys, read by code (Charles 26/11): how she presents the step, never its price. Absent or `unknown`, nothing
   * is said.
   */
  readonly buyerType?: BuyerType;
}

/** How a fan buys (Charles 26/11): a hint for how she presents an offer; the price never moves with it. */
export type BuyerType = 'impulsive' | 'hesitant' | 'collector' | 'whale' | 'unknown';

/**
 * His fantasy, for the voice (Charles 26/11): the one the script running with him meets, to play on in the sexting,
 * and those no script of hers meets, never to promise. Each in his own words, read as data.
 */
export interface VoiceFantasy {
  readonly playOn: readonly string[];
  readonly noScript: readonly string[];
}

/** A paid step sent to him and still locked, as the voice reads it to help him open it (ADR 0156 § 4). */
export interface VoiceWaitingStep {
  readonly price: Money;
  readonly mediaSheet: string | null;
}

/**
 * The language she writes in, decided by code (ADR 0168 § 2), never guessed by the model: a fixed instruction of the
 * voice, with his language she does not speak (said once, her way) and her examples in that language, when she has some.
 */
export interface VoiceLanguage {
  readonly reply: Language;
  /** His language she does not speak, to tell him once; `'unknown'` when code cannot name it; `null`: nothing to say. */
  readonly notSpoken: Language | 'unknown' | null;
  /** Her messages written in `reply` (persona, `language_examples`): read only when she writes in that language. */
  readonly examples?: readonly string[];
}

export interface VoiceInput extends ConversationInput {
  readonly brief: Brief;
  /** The language of her answer (ADR 0168). Absent: the prompt says nothing more than her sheet. */
  readonly language?: VoiceLanguage;
  /**
   * A reply of her bank to his price objection (ADR 0090 § 8), chosen by code: the voice says it in her words, in a
   * typed block after the brief. Absent, none.
   */
  readonly objectionReply?: string;
  /** The script step code decided to send now, in a typed block after the brief. Absent, none. */
  readonly scriptStep?: VoiceScriptStep;
  /**
   * The paid step he was sent and has not opened, when he asks how to pay for it (ADR 0156 § 4): its exact price and
   * what it holds, in a typed block after the brief. Absent, none.
   */
  readonly waitingStep?: VoiceWaitingStep;
  /** The most bubbles she may write this turn, decided by code (1 to 3). Absent, the prompt's own rule. */
  readonly maxBubbles?: number;
  /** His fantasy to play on, or not to promise (Charles 26/11), each in a typed block after the brief. Absent, none. */
  readonly fantasy?: VoiceFantasy;
  /**
   * What the step of her script he has in front of him shows (Charles 26/11 at 22:47): the media sheet of the last
   * step he can see (offered, or paid and opened), for the sexting between two steps, said in the present. Never a
   * paid step he has not bought. Absent, none.
   */
  readonly currentStepSheet?: string;
  /**
   * What the media he bought and finds disappointing shows, by its description (Charles 26/11): she compares it with
   * what he says. Absent, none.
   */
  readonly boughtMediaSheet?: string;
  /**
   * Her own accounts code opens this turn (Charles 27/11): her Instagram when he asked for it (her wishlist, a cam), her
   * TikTok when he spoke of her lives, in a typed block after the brief. Never the handle (Sécurité, 27/11): the voice
   * writes the account's fixed token, code puts the handle in its place. Absent or empty, none.
   */
  readonly openAccounts?: readonly HerAccountPlatform[];
  /**
   * The agency's base style (ADR 0173), its public then its private part, in typed blocks before her sheet, which
   * wins where they differ. Absent or both empty: no section.
   */
  readonly agencyStyle?: AgencyStyleText;
}

/** One of her own accounts, by its platform only: its handle never enters a prompt. */
export type HerAccountPlatform = 'instagram' | 'tiktok';

/** The two texts of the agency's base style (ADR 0173), as the owner wrote them. */
export interface AgencyStyleText {
  readonly publicStyle: string;
  readonly privateStyle: string;
}

/**
 * The situation the agent saw when it wrote the reply, as the judge reads it (evals only): written by code, never by
 * the fan, so the judge scores safety against his real state (an adult whose age is confirmed may be flirted with).
 */
export interface JudgeSituation {
  /** The moment as the brain and the voice read it (`describeSituation`): her time, day or night, what he spent. */
  readonly description: string;
  /** Hours since their first message (`relationshipStartedAt`). */
  readonly relationshipHours: number;
  /** His age is confirmed (`ageConfirmedAt`), as the sexualisation cursor reads it. */
  readonly ageConfirmed: boolean;
  /** Hours since the last script offered to him (`lastOfferAt`); `null`: none yet. */
  readonly lastOfferHoursAgo: number | null;
  readonly hasNoBudget: boolean;
  /** His limits (`fans.flags`), as the policy reads them before any offer. */
  readonly flags: FanFlags;
}

/** A reply she is about to send, scored by the judge (evals only: never on a real fan's path). */
export interface JudgeInput extends Omit<ConversationInput, 'situation'> {
  /** Absent: the judge is told it knows nothing of the moment, and reads his age as unknown. */
  readonly situation?: JudgeSituation;
  readonly reply: readonly string[];
  readonly criteria: readonly JudgeCriterion[];
}

/** The captures of a post marked during a trend watch (ADR 0060 § 2, source 6), in memory only. */
export interface TrendCapturesInput {
  readonly captures: readonly { readonly mediaType: string; readonly data: Uint8Array }[];
  /** The video's length as the page showed it; null for a photo or a carousel. */
  readonly durationS: number | null;
  /** Always a trend watch call: its purpose is set by the gateway. */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/**
 * A post of her Telegram channel (ADR 0080 § 5), written in her voice for everyone who reads the channel: the main post
 * that reacts to its media and leads to her link (§ 5.8), a post of engagement without a link, or a poll (§ 5.7). The
 * examples, where her link leads and the advice are the agency's words, read as data.
 */
export interface ChannelPostInput {
  readonly kind: 'main' | 'engagement' | 'poll';
  readonly creatorName: string;
  /** Her persona sheet, rendered as text, as the voice reads it. */
  readonly personaSheet: string;
  /** Her channel's posts chosen as examples (§ 5.5); empty: none. */
  readonly examples: readonly string[];
  /** The media the post goes with, described in words; null: a text alone. */
  readonly media: string | null;
  /** Where the link of the main post leads (§ 4.5); null or empty: no place is named. Ignored for another kind. */
  readonly destination: string | null;
  /** The agency's advice for this post (§ 2.3); null: none. */
  readonly advice: string | null;
  /** Always a `telegram` call: its purpose is set by the gateway (ADR 0091 § 8). */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/**
 * A comment under one of her Instagram posts (ADR 0122 § 2), for the outcome she gives it. `comment` is the block the
 * code prepared (`CommentPromptInput`): no name nor handle has a field to enter by. The persona sheet holds her public
 * panels only.
 */
export interface InstagramCommentInput {
  readonly creatorName: string;
  readonly personaSheet: string;
  /**
   * The public part of the agency's base style (ADR 0173, `publicBaseStyleOf`), in the system before her sheet, as
   * data; absent or empty: none. The private part never reaches a public reply.
   */
  readonly publicStyle?: string;
  /** Her validated replies of the bank « commentaire »; empty: none. */
  readonly examples: readonly string[];
  /** Her most recent replies, so that she does not write the same one twice; empty: none. */
  readonly recentReplies: readonly string[];
  /**
   * Her real replies to the comments that read closest to this one, picked by the code (Charles, 26/11): in the
   * message, not the system, so the cached system stays the same from one comment to the next; empty: none.
   */
  readonly nearExamples?: readonly { readonly comment: string; readonly reply: string }[];
  /** The shape of her reply to the closest comment, decided by the code (`replyShapeOf`); absent: the prompt alone. */
  readonly replyShape?: {
    readonly emojis: 0 | 1 | 2;
    readonly exclaims: boolean;
    readonly words: number;
  };
  readonly comment: CommentPromptInput;
  /** What the guards refused in a first reply: this call is the one rewrite (§ 3). Rule names only, never a text. */
  readonly refusedBy?: readonly string[];
  /** Always a comment call: its purpose is set by the gateway. */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/** What three captions are written from (ADR 0164 § 9). Every text of hers or of a media is read as data. */
export interface CaptionProposalsInput {
  readonly creatorName: string;
  readonly personaSheet: string;
  /** Her past captions that did well, the most recent first; empty: none. */
  readonly examples: readonly string[];
  /** What the vision AI saw in the video (ADR 0083 § 2). */
  readonly mediaDescription: string;
  readonly durationS: number | null;
  /** The sentence she wrote with her drop; null: none. */
  readonly sentence: string | null;
  /** « D'autres idées »: the hints she touched, in French, and her own line; the captions she already read. */
  readonly otherIdeas?: {
    readonly hints: readonly string[];
    readonly note: string;
    readonly seen: readonly string[];
  };
  /** What the guard refused in a first answer: this call is the one rewrite. Rule names only, never a text. */
  readonly refusedBy?: readonly string[];
  /** Always a caption call: its purpose is set by the gateway. */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/** A media of a step, as its description tells it; a voice note is not described by the vision AI. */
export interface ScriptSummaryMedia {
  readonly kind: 'image' | 'video' | 'audio';
  readonly durationS: number | null;
  /** The detailed description of the photo or video (ADR 0083 § 2); null for a voice note. */
  readonly description: string | null;
}

/** A step of the script she shot: its key, its code (`E1A`, `P12`), its card and its media in order. */
export interface ScriptSummaryStep {
  readonly step: string;
  readonly code: string;
  readonly name: string;
  /** What the card says beyond its name (what it sells, mood, outfit, place, the series' and slots' hints). */
  readonly card: string | null;
  readonly media: readonly ScriptSummaryMedia[];
}

/**
 * A sent script told step by step, then its synthesis (ADR 0083 § 6, role `brain`): from the cards and the media's
 * descriptions only, never a price (ADR 0056 § 6). The cards and the descriptions are read as data.
 */
export interface ScriptSummaryInput {
  readonly scriptName: string;
  readonly moment: 'day' | 'night' | null;
  readonly steps: readonly ScriptSummaryStep[];
  /** Always a `media` call: its purpose is set by the gateway (ADR 0091 § 8). */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/** A step of a native script, as the identity is told it: its name, its offer's text and its media in order. */
interface ScriptIdentityStep {
  readonly name: string;
  readonly text: string;
  /** Each media's validated description (photo, video), in the platform's order; a voice note has none. */
  readonly media: readonly ScriptSummaryMedia[];
}

/**
 * A native script's identity (SC-04 lot c8, role `brain`, prompt `brain/script-identity`): from its steps' names and
 * texts and its media's validated descriptions, never a price nor the moment, which the code holds. All are read as
 * data.
 */
export interface ScriptIdentityInput {
  readonly scriptName: string;
  readonly steps: readonly ScriptIdentityStep[];
  /** Always a `media` call: its purpose is set by the gateway (ADR 0091 § 8). */
  readonly trace?: Omit<CallTrace, 'purpose'>;
}

/** A message of the conversation the card is read in, numbered from 1 in the order they were written. */
export interface FanCardReadMessage {
  readonly number: number;
  readonly from: 'fan' | 'creator';
  readonly text: string;
  /** His messages not read yet: the only ones a value may rest on; the others are context. */
  readonly isNew: boolean;
}

/**
 * His card read again in his new messages (ADR 0085 § 7, role `brain`, prompt `brain/fan-card`): the card as it is,
 * one line per known field, then the conversation. Both come from him, read as data. The call counts in the
 * « chatting » budget and is refused from the alert on (§ 7: it stops before a fan's answer would).
 */
export interface FanCardReadInput {
  /** `code : valeur (source)`, one line per field the card knows. */
  readonly card: readonly string[];
  readonly messages: readonly FanCardReadMessage[];
  readonly trace?: CallTrace;
}

export type ChannelPostResult =
  ({ readonly kind: 'post' } & ChannelPostOutput) | ({ readonly kind: 'poll' } & ChannelPollOutput);

export interface CallMeta {
  readonly provider: ProviderId;
  readonly model: string;
  readonly isFallback: boolean;
  readonly latencyMs: number;
  readonly costUsd?: number;
  readonly promptHash: string;
}

export interface LlmSuccess<T> {
  readonly output: T;
  readonly meta: CallMeta;
}

export interface LlmFailure {
  /**
   * `budget_reached`: the daily cap is spent, nothing was called; the chatters take over until midnight.
   * `trend_watch_budget_reached`: a trend watch call, refused at the watch's own cap; its jobs stop until midnight,
   * the fans' answers go on.
   */
  readonly code: 'all_models_failed' | 'budget_reached' | 'trend_watch_budget_reached';
  readonly attempts: readonly {
    readonly provider: ProviderId;
    readonly model: string;
    readonly outcome: CallOutcome;
  }[];
}

/** The owner's « Essai réel » of a provider (ADR 0091 § 7). */
export interface ConnectionTest {
  readonly provider: ProviderId;
  readonly isOk: boolean;
  readonly model?: string;
  /** The model as the screen names it (« Grok 4.7 »). */
  readonly modelLabel?: string;
  /** Absent when no call was made. */
  readonly latencyMs?: number;
  /** `budget_reached`: the day's cap stopped it before any call. */
  readonly outcome: CallOutcome | 'budget_reached';
}

export interface LlmGateway {
  sense(input: SenseInput): Promise<Result<LlmSuccess<MediaDescription>, LlmFailure>>;
  /** A media she dropped, described in detail (ADR 0083, prompt `sense/creator-drop`), under the daily cap. */
  describeDrop(input: DropSenseInput): Promise<Result<LlmSuccess<DropMediaDescription>, LlmFailure>>;
  brain(input: BrainInput): Promise<Result<LlmSuccess<Brief>, LlmFailure>>;
  voice(input: VoiceInput): Promise<Result<LlmSuccess<VoiceOutput>, LlmFailure>>;
  /** Scores a reply against the rubric criteria (`pnpm evals`). */
  judge(input: JudgeInput): Promise<Result<LlmSuccess<JudgeOutput>, LlmFailure>>;
  /**
   * How a marked post is made, from its captures (vision, role `sense`): a trend watch call, under the watch's cap
   * (`trend_watch_budget_reached`) and the daily one. The captures are read, never kept nor journaled.
   */
  describeTrendCaptures(
    input: TrendCapturesInput,
  ): Promise<Result<LlmSuccess<TrendCaptureDescription>, LlmFailure>>;
  /** A post or a poll of her Telegram channel (ADR 0080 § 5, role `voice`). */
  channelPost(input: ChannelPostInput): Promise<Result<LlmSuccess<ChannelPostResult>, LlmFailure>>;
  /**
   * What she does of a comment under one of her Instagram posts (ADR 0122 § 2, role `voice`), journaled under the
   * purpose `instagram_comment` and stopped by the daily cap. The guards run after, in the code.
   */
  instagramComment(input: InstagramCommentInput): Promise<Result<LlmSuccess<CommentOutcome>, LlmFailure>>;
  /**
   * Captions for a Reel she dropped, each in its own style (ADR 0164 § 9, prompt `voice/instagram-caption`): journaled
   * under the purpose `instagram_caption` and stopped by the daily cap. The guard runs after, in the code.
   */
  proposeCaptions(input: CaptionProposalsInput): Promise<Result<LlmSuccess<CaptionProposals>, LlmFailure>>;
  /** A sent script's steps and synthesis (ADR 0083 § 6, prompt `brain/script-summary`), under the daily cap. */
  summarizeScript(input: ScriptSummaryInput): Promise<Result<LlmSuccess<ScriptDropSummary>, LlmFailure>>;
  /** A native script's identity (SC-04 lot c8, prompt `brain/script-identity`), under the daily cap. */
  identifyScript(input: ScriptIdentityInput): Promise<Result<LlmSuccess<ScriptIdentityContent>, LlmFailure>>;
  /**
   * What his new messages teach about him, field by field (ADR 0085 § 7). `budget_reached` as soon as the day's
   * spend is at its alert, so the card never takes what a fan's answer needs.
   */
  readCard(input: FanCardReadInput): Promise<Result<LlmSuccess<FanCardRead>, LlmFailure>>;
  /**
   * The version of the prompts whose outputs are kept and redone when they change (ADR 0083 § 2): a drop's description
   * and a script's synthesis, as `meta.promptHash` gives them.
   */
  readonly promptHashes: {
    readonly creatorDrop: string;
    readonly scriptSummary: string;
    readonly scriptIdentity: string;
  };
  health(): HealthReport;
  /**
   * One tiny real call (« Réponds seulement : ok ») on the model the config uses for this provider: the owner's
   * « Essai réel » (ADR 0091 § 7). Journaled under the purpose `probe`, stopped by the day's cap. Never throws.
   */
  testConnection(provider: ProviderId): Promise<ConnectionTest>;
  /** The sound of a video or a voice note, as text for `sense`. */
  transcribe(audio: {
    readonly data: Uint8Array;
    readonly mediaType: string;
    /** From ffprobe: prices the call when the provider gives no duration. */
    readonly durationS?: number;
    readonly trace?: CallTrace;
  }): Promise<Result<Transcript, LlmFailure>>;
}

export interface LlmGatewayDeps {
  readonly config: LlmConfig;
  /** The environment's keys, or a source reading the keys saved in the CRM. */
  readonly credentials: ApiKeys;
  readonly resolveModel: ModelResolver;
  readonly log: LlmCallLog;
  readonly now?: () => Date;
  readonly prompts?: {
    readonly voice: PromptTemplate;
    readonly brain: PromptTemplate;
    readonly sense: PromptTemplate;
    readonly judge?: PromptTemplate;
    readonly trendCaptures?: PromptTemplate;
    readonly creatorDrop?: PromptTemplate;
    readonly channelPost?: PromptTemplate;
    readonly instagramComment?: PromptTemplate;
    readonly instagramCaption?: PromptTemplate;
    readonly scriptSummary?: PromptTemplate;
    readonly scriptIdentity?: PromptTemplate;
    readonly fanCard?: PromptTemplate;
  };
  /** Secret written in every system prompt: an output that contains it has leaked the prompt. */
  readonly canary?: string;
  /** Speech to text (xAI); undefined when no key is set. */
  readonly resolveTranscriber?: () => TranscriptionModel | undefined;
  /**
   * A provider answered 401 or 403 on a real call: its key was revoked or lacks a right. The providers module
   * marks the service « à reconnecter » (ADR 0016). Called once per refused attempt; never throws into a call.
   */
  readonly onKeyRefused?: (refusal: KeyRefusal) => void;
  /** The cap in euros set in Réglages (later); `config.dailyBudget.capEur` otherwise. Read before each call. */
  readonly dailyCapEur?: () => number;
  /** The trend watch's cap in euros, inside the daily one; `config.dailyBudget.trendWatchCapEur` otherwise. */
  readonly trendWatchCapEur?: () => number;
  /** Once per day and kind: alert at 80 %, then cap reached. Never throws into a call. */
  readonly onBudget?: (event: BudgetEvent) => void;
  /** Waits before a transient retry (backoff); a real timer unless a test passes its own. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Waits before a hedged second request (`hedgeAfterMs`) until the signal aborts it; a real timer unless a test passes its own. */
  readonly hedgeTimer?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface KeyRefusal {
  readonly provider: ProviderId;
  /** 401: the key is unknown or revoked. 403: the key exists but may not use this model or service. */
  readonly status: 401 | 403;
}

export interface Transcript {
  readonly text: string;
  readonly durationS?: number;
}
