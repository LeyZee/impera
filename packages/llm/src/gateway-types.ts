import type {
  DropMediaDescription,
  LlmPurpose,
  MediaDescription,
  Result,
  ScriptDropSummary,
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
  readonly trace?: CallTrace;
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

export interface BrainInput extends ConversationInput {
  /** Her alerts written as a phrase, at most `BRAIN_ALERTS_MAX`; absent or empty, none is read. */
  readonly alerts?: readonly BrainAlert[];
}

export interface VoiceInput extends ConversationInput {
  readonly brief: Brief;
}

/** A reply she is about to send, scored by the judge (evals only: never on a real fan's path). */
export interface JudgeInput extends ConversationInput {
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
  readonly trace?: CallTrace;
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

export interface ConnectionTest {
  readonly provider: ProviderId;
  readonly isOk: boolean;
  readonly model?: string;
  readonly latencyMs?: number;
  readonly outcome: CallOutcome;
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
  /** A sent script's steps and synthesis (ADR 0083 § 6, prompt `brain/script-summary`), under the daily cap. */
  summarizeScript(input: ScriptSummaryInput): Promise<Result<LlmSuccess<ScriptDropSummary>, LlmFailure>>;
  /**
   * The version of the prompts whose outputs are kept and redone when they change (ADR 0083 § 2): a drop's description
   * and a script's synthesis, as `meta.promptHash` gives them.
   */
  readonly promptHashes: { readonly creatorDrop: string; readonly scriptSummary: string };
  health(): HealthReport;
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
    readonly scriptSummary?: PromptTemplate;
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
