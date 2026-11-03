import { z } from 'zod';

/** Closed value sets shared by the database (`text` + `check`), the API and the jobs (data-model.md). */

export const PlatformSchema = z.enum(['reveal', 'onlyfans', 'instagram', 'impera']);
export type Platform = z.infer<typeof PlatformSchema>;

/** A platform as people write it, on a screen or an invoice: never its code. */
export const PLATFORM_NAMES: Readonly<Record<Platform, string>> = {
  reveal: 'Reveal',
  onlyfans: 'OnlyFans',
  instagram: 'Instagram',
  impera: 'Impera',
};

export const ConversationStateSchema = z.enum([
  'idle',
  'pending',
  'drafting',
  'awaiting_approval',
  'sending',
  'human',
  'paused',
  'error',
]);
export type ConversationState = z.infer<typeof ConversationStateSchema>;

export const ConversationModeSchema = z.enum(['copilot', 'auto']);
export type ConversationMode = z.infer<typeof ConversationModeSchema>;

export const DraftStatusSchema = z.enum([
  'pending',
  'approved',
  'edited',
  'rejected',
  'sent',
  'failed',
  'expired',
]);
export type DraftStatus = z.infer<typeof DraftStatusSchema>;

export const MessageDirectionSchema = z.enum(['inbound', 'outbound']);
export type MessageDirection = z.infer<typeof MessageDirectionSchema>;

export const MessageAuthorSchema = z.enum(['fan', 'human', 'ai']);
export type MessageAuthor = z.infer<typeof MessageAuthorSchema>;

/** State of a captured platform session; `none` until the extension syncs one. */
export const SessionStateSchema = z.enum(['none', 'valid', 'warning', 'expired']);
export type SessionState = z.infer<typeof SessionStateSchema>;

export const FactCategorySchema = z.enum([
  'identity',
  'life',
  'interests',
  'preferences',
  'commercial',
  'intimate',
  'events',
  /** A chatter's note, written when they give the conversation back (`release`); never proposed by a model. */
  'operator_note',
]);
export type FactCategory = z.infer<typeof FactCategorySchema>;

export const FactKindSchema = z.enum(['declared', 'inferred']);
export type FactKind = z.infer<typeof FactKindSchema>;

export const LlmRoleSchema = z.enum(['sense', 'brain', 'voice', 'judge']);
export type LlmRole = z.infer<typeof LlmRoleSchema>;

/**
 * What an LLM call is for, journaled in `llm_calls.purpose` (ADR 0060 § 7). `chatting` is every call that serves
 * the fans and their conversations; `trend_watch` is the trend watch, which has its own cap inside the daily one and
 * never deprives a fan's answer of budget.
 */
export const LlmPurposeSchema = z.enum(['chatting', 'trend_watch']);
export type LlmPurpose = z.infer<typeof LlmPurposeSchema>;

/** Who wrote an event: the system, the AI, a dashboard user (`human:<userId>`) or the fan. */
export const ActorSchema = z.union([
  z.enum(['system', 'ai', 'fan']),
  z.templateLiteral(['human:', z.uuid()]),
]);
export type Actor = z.infer<typeof ActorSchema>;
