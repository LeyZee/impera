import { z } from 'zod';

import { MessageMediaViewSchema, PageQuerySchema } from './conversations';
import { MessageDirectionSchema } from './enums';
import { ConversationIdSchema, FanIdSchema, MessageIdSchema } from './ids';
import { CurrencySchema } from './money';

/**
 * What a creator reads of her own account in her space (CR-02, ADR 0042 § 2): her fans and their conversations, read
 * only. Every object is `strict`: of who wrote a message she reads only `writtenBy` (ADR 0065 § 1), never the agency's
 * own fields, so a field the server would add by mistake (`author`, `draftId`) fails the contract instead of reaching
 * her screen. Her creator is read in her account by the server (`withCreatorAccount`), never in the request.
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
 * `GET /v1/creator-space/conversations/:id` (creator): the conversation she opens and its fan, by his pseudo. No note
 * of him: what the agency knows of a fan is its own (Charles, 03/11; she will read figures of her whole base, never one
 * fan's). Each opening is written in the audit log, as a chatter's would be. Another creator's conversation, or none,
 * answers 404 `conversation_not_found`.
 */
export const CreatorConversationSchema = z.strictObject({
  id: ConversationIdSchema,
  fan: z.strictObject({ id: FanIdSchema, displayName: z.string() }),
});
export type CreatorConversation = z.infer<typeof CreatorConversationSchema>;

/**
 * Who wrote one of her sent messages, as she reads it (CRE-04, ADR 0065 § 1): a chatter by his display name (the one
 * of « Qui répond à tes fans »), the AI (`ai`, « Automatique »), or someone on the platform outside Impera (`platform`,
 * « Écrit sur Reveal »). `agency`: a draft corrected by someone of the agency who is not a member of the team (the
 * owner), who has no display name to show. The screen turns each kind into its words; nothing else of the AI or the
 * team comes out: no draft, no reviewer, no guard's verdict, no model call.
 */
export const CreatorMessageWriterSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('chatter'), displayName: z.string().min(1) }),
  z.strictObject({ kind: z.literal('ai') }),
  z.strictObject({ kind: z.literal('platform') }),
  z.strictObject({ kind: z.literal('agency') }),
]);
export type CreatorMessageWriter = z.infer<typeof CreatorMessageWriterSchema>;

/**
 * One message as she reads it: its direction and, for one of hers, who wrote it (`writtenBy`, ADR 0065 § 1). `inbound`
 * is her fan's and carries no writer (`null`); `outbound` is hers as the fan saw it.
 */
export const CreatorMessageSchema = z
  .strictObject({
    id: MessageIdSchema,
    direction: MessageDirectionSchema,
    writtenBy: CreatorMessageWriterSchema.nullable(),
    text: z.string(),
    media: z.array(MessageMediaViewSchema.strict()),
    priceMinor: z.number().int().min(0).nullable(),
    currency: CurrencySchema.nullable(),
    isPaid: z.boolean(),
    platformCreatedAt: z.iso.datetime(),
  })
  .refine((message) => (message.direction === 'inbound') === (message.writtenBy === null), {
    message: 'a fan’s message has no writer, and each of hers has one',
    path: ['writtenBy'],
  });
export type CreatorMessage = z.infer<typeof CreatorMessageSchema>;

/** `GET /v1/creator-space/conversations/:id/messages?limit=&cursor=` (creator): newest first. */
export const CreatorMessagesQuerySchema = PageQuerySchema;
export const CreatorMessagePageSchema = z.strictObject({
  items: z.array(CreatorMessageSchema),
  nextCursor: z.string().nullable(),
});
export type CreatorMessagePage = z.infer<typeof CreatorMessagePageSchema>;
