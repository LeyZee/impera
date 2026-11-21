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

/**
 * Where a message comes from when the platform wrote it for someone (ADR 0110): `hook`, an opener the platform offered
 * the fan as he subscribed, sent under his name; `welcome`, the creator's welcome sent by the platform;
 * `expiration_reminder`, the platform's reminder before his subscription ends; `story_reply`, his answer to one of her
 * stories. Absent: written by its author.
 */
export const MessageOriginSchema = z.enum(['hook', 'welcome', 'expiration_reminder', 'story_reply']);
export type MessageOrigin = z.infer<typeof MessageOriginSchema>;

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

/**
 * A fact as stored (`fan_facts.kind`): what a model proposes (`FactKindSchema`), or a value a chatter wrote on the fan's
 * card (`noted`, ADR 0085 § 5), never proposed by a model.
 */
export const StoredFactKindSchema = z.enum([...FactKindSchema.options, 'noted']);
export type StoredFactKind = z.infer<typeof StoredFactKindSchema>;

export const LlmRoleSchema = z.enum(['sense', 'brain', 'voice', 'judge']);
export type LlmRole = z.infer<typeof LlmRoleSchema>;

/**
 * What an LLM call is for, journaled in `llm_calls.purpose` (ADR 0060 § 7). `chatting` is every call that serves
 * the fans and their conversations; `trend_watch` is the trend watch, which has its own cap inside the daily one and
 * never deprives a fan's answer of budget; `probe` is the owner's « Essai réel » of a service (ADR 0091 § 7), one
 * tiny call on his click, counted in the spend and left out of the agent's health. `instagram_comment` is a reply
 * to a comment under one of her Instagram posts (ADR 0122), counted apart and stopped by the daily cap like any call.
 * `media` is the description of what she drops and of a sent script (ADR 0083), `telegram` a post of her channel
 * (ADR 0080): both are counted apart for the forecast (ADR 0091 § 8) and stopped by the daily cap like any call.
 */
export const LlmPurposeSchema = z.enum([
  'chatting',
  'trend_watch',
  'probe',
  'instagram_comment',
  'media',
  'telegram',
]);
export type LlmPurpose = z.infer<typeof LlmPurposeSchema>;

/** Who wrote an event: the system, the AI, a dashboard user (`human:<userId>`) or the fan. */
export const ActorSchema = z.union([
  z.enum(['system', 'ai', 'fan']),
  z.templateLiteral(['human:', z.uuid()]),
]);
export type Actor = z.infer<typeof ActorSchema>;
