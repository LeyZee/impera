import { z } from 'zod';

import { MessageMediaViewSchema, PageQuerySchema } from './conversations';
import { MessageDirectionSchema } from './enums';
import { ConversationIdSchema, FanIdSchema, MessageIdSchema } from './ids';
import { CurrencySchema } from './money';

/**
 * What a creator reads of her own account in her space (CR-02, ADR 0042 § 2): her fans and their conversations, read
 * only. Every object is `strict`: she sees a message, never who wrote it (chatter or agent, ADR 0021), so a field the
 * server would add by mistake (`author`, `draftId`) fails the contract instead of reaching her screen. Her creator is
 * read in her account by the server (`withCreatorAccount`), never in the request.
 */

/** What a fan paid in his conversation, per currency, in minor units: unlocked paid messages only. */
export const CreatorFanSpentSchema = z.strictObject({
  eurMinor: z.number().int().min(0),
  usdMinor: z.number().int().min(0),
});
export type CreatorFanSpent = z.infer<typeof CreatorFanSpentSchema>;

/**
 * One of her fans (Ventes › Fans): his pseudo, what he paid, when he was first and last seen, and his conversation,
 * which opens from him (ADR 0042 § 8). `conversationId` is `null` for a fan seen without a conversation yet.
 */
export const CreatorFanSchema = z.strictObject({
  id: FanIdSchema,
  displayName: z.string(),
  conversationId: ConversationIdSchema.nullable(),
  spent: CreatorFanSpentSchema,
  firstSeenAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});
export type CreatorFan = z.infer<typeof CreatorFanSchema>;

/** `GET /v1/creator-space/fans?limit=&cursor=` (creator): her fans, last seen first. */
export const CreatorFansQuerySchema = PageQuerySchema;
export const CreatorFanPageSchema = z.strictObject({
  items: z.array(CreatorFanSchema),
  nextCursor: z.string().nullable(),
});
export type CreatorFanPage = z.infer<typeof CreatorFanPageSchema>;

/**
 * `GET /v1/creator-space/conversations/:id` (creator): the conversation she opens, with her fan's notes (what the agent
 * learned of him and keeps). Each opening is written in the audit log, as a chatter's would be. Another creator's
 * conversation, or none, answers 404 `conversation_not_found`.
 */
export const CreatorConversationSchema = z.strictObject({
  id: ConversationIdSchema,
  fan: z.strictObject({
    id: FanIdSchema,
    displayName: z.string(),
    notes: z.array(z.string().min(1)),
  }),
});
export type CreatorConversation = z.infer<typeof CreatorConversationSchema>;

/**
 * One message as she reads it: its direction, never its author. `inbound` is her fan's, `outbound` is hers as the fan
 * saw it, whoever wrote it.
 */
export const CreatorMessageSchema = z.strictObject({
  id: MessageIdSchema,
  direction: MessageDirectionSchema,
  text: z.string(),
  media: z.array(MessageMediaViewSchema.strict()),
  priceMinor: z.number().int().min(0).nullable(),
  currency: CurrencySchema.nullable(),
  isPaid: z.boolean(),
  platformCreatedAt: z.iso.datetime(),
});
export type CreatorMessage = z.infer<typeof CreatorMessageSchema>;

/** `GET /v1/creator-space/conversations/:id/messages?limit=&cursor=` (creator): newest first. */
export const CreatorMessagesQuerySchema = PageQuerySchema;
export const CreatorMessagePageSchema = z.strictObject({
  items: z.array(CreatorMessageSchema),
  nextCursor: z.string().nullable(),
});
export type CreatorMessagePage = z.infer<typeof CreatorMessagePageSchema>;
