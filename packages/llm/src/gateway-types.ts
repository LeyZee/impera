import type { MediaDescription, Result } from '@nirvana/contracts';
import type { TranscriptionModel } from 'ai';

import type { BudgetEvent } from './budget';
import type { CallOutcome, LlmCallLog } from './call-log';
import type { ApiKeys, LlmConfig, ProviderId } from './config';
import type { HealthReport } from './health';
import type { PromptTemplate } from './prompts';
import type { ModelResolver } from './providers';
import type { Brief, JudgeCriterion, JudgeOutput, VoiceOutput } from './schemas';

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
      readonly data: Uint8Array;
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
}

export interface SenseInput {
  /** A fan's media is described to react to it; one of hers, to talk about it and make him want it. */
  readonly origin: 'fan' | 'creator';
  readonly media: SenseMedia;
  readonly trace?: CallTrace;
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
  /** `budget_reached`: the daily cap is spent, nothing was called; the chatters take over until midnight. */
  readonly code: 'all_models_failed' | 'budget_reached';
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
  brain(input: BrainInput): Promise<Result<LlmSuccess<Brief>, LlmFailure>>;
  voice(input: VoiceInput): Promise<Result<LlmSuccess<VoiceOutput>, LlmFailure>>;
  /** Scores a reply against the rubric criteria (`pnpm evals`). */
  judge(input: JudgeInput): Promise<Result<LlmSuccess<JudgeOutput>, LlmFailure>>;
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
