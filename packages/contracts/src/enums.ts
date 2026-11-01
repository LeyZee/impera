import { z } from 'zod';

/** Closed value sets shared by the database (`text` + `check`), the API and the jobs (data-model.md). */

export const PlatformSchema = z.enum(['reveal', 'onlyfans', 'instagram', 'nirvana']);
export type Platform = z.infer<typeof PlatformSchema>;

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

/** Who wrote an event: the system, the AI, a dashboard user (`human:<userId>`) or the fan. */
export const ActorSchema = z.union([
  z.enum(['system', 'ai', 'fan']),
  z.templateLiteral(['human:', z.uuid()]),
]);
export type Actor = z.infer<typeof ActorSchema>;
