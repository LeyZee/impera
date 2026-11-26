import { z } from 'zod';

import { CreatorIdSchema } from './ids';

/**
 * « Écrire à l'agence » (Charles, 21/11, trous béants n° 13): she writes to the agency from her space, a question, an
 * idea or a worry, in her words; it waits in the owner's « À faire » until he answers, and his answer comes back on her
 * card. Her words are data: nothing of them ever enters a prompt. Nothing is deleted.
 */

export const CREATOR_MESSAGE_KINDS = ['question', 'idea', 'worry'] as const;
export const ToAgencyMessageKindSchema = z.enum(CREATOR_MESSAGE_KINDS);
export type ToAgencyMessageKind = z.infer<typeof ToAgencyMessageKindSchema>;

/** How she names each kind, on her form and on the owner's line. */
export const CREATOR_MESSAGE_KIND_WORDS: Readonly<Record<ToAgencyMessageKind, string>> = {
  question: 'Une question',
  idea: 'Une idée',
  worry: 'Un souci',
};

/** Her message, and the owner's answer, in characters. */
export const CREATOR_MESSAGE_TEXT_MAX = 1000;
/** Her space lists her latest messages, this many at most. */
export const CREATOR_MESSAGES_SHOWN = 20;

/** Chosen by her phone: a replay writes nothing twice. */
const ToAgencyMessageIdSchema = z.uuid();

const textOf = (max: number) =>
  z
    .string()
    .trim()
    .transform((text) => text.replace(/[ \t]+/gu, ' ').replace(/\n{3,}/gu, '\n\n'))
    .pipe(z.string().min(1).max(max));

export const ToAgencyMessageSchema = z.strictObject({
  id: ToAgencyMessageIdSchema,
  creatorId: CreatorIdSchema,
  kind: ToAgencyMessageKindSchema,
  body: z.string().min(1).max(CREATOR_MESSAGE_TEXT_MAX),
  createdAt: z.iso.datetime(),
  answer: z.string().min(1).max(CREATOR_MESSAGE_TEXT_MAX).nullable(),
  answeredAt: z.iso.datetime().nullable(),
});
export type ToAgencyMessage = z.infer<typeof ToAgencyMessageSchema>;

/** `GET /v1/creator-space/messages` (her): her latest messages, the newest first, each with its answer once given. */
export const ToAgencyMessagesSchema = z.strictObject({ messages: z.array(ToAgencyMessageSchema) });
export type ToAgencyMessages = z.infer<typeof ToAgencyMessagesSchema>;

/** `POST /v1/creator-space/messages` → 201 `ToAgencyMessage`. */
export const NewToAgencyMessageBodySchema = z.strictObject({
  id: ToAgencyMessageIdSchema,
  kind: ToAgencyMessageKindSchema,
  body: textOf(CREATOR_MESSAGE_TEXT_MAX),
});
export type NewToAgencyMessageBody = z.infer<typeof NewToAgencyMessageBodySchema>;

/** One message waiting on the agency, with whose it is. */
export const WaitingToAgencyMessageSchema = ToAgencyMessageSchema.extend({ creatorName: z.string().min(1) });
export type WaitingToAgencyMessage = z.infer<typeof WaitingToAgencyMessageSchema>;

/**
 * `GET /v1/creator-messages/waiting` (owner; an active manager reads): the messages of every creator not answered yet,
 * the oldest first.
 */
export const WaitingToAgencyMessagesSchema = z.strictObject({
  messages: z.array(WaitingToAgencyMessageSchema),
});
export type WaitingToAgencyMessages = z.infer<typeof WaitingToAgencyMessagesSchema>;

/** `POST /v1/creators/:creatorId/messages/:id/answer` (owner) → 200 `ToAgencyMessage`; the same answer again is a replay. */
export const ToAgencyMessageParamsSchema = z.strictObject({
  creatorId: CreatorIdSchema,
  id: ToAgencyMessageIdSchema,
});
export const AnswerToAgencyMessageBodySchema = z.strictObject({ answer: textOf(CREATOR_MESSAGE_TEXT_MAX) });
export type AnswerToAgencyMessageBody = z.infer<typeof AnswerToAgencyMessageBodySchema>;

/** Answered already with other words: the first answer stands. */
export const CREATOR_MESSAGE_ANSWERED_CONFLICT = 'creator_message_answered_conflict';
