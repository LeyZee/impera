import { z } from 'zod';

import { MessageMediaViewSchema, PageQuerySchema } from './conversations';
import { MessageDirectionSchema } from './enums';
import { ConversationIdSchema, FanIdSchema, MessageIdSchema } from './ids';
import { CurrencySchema } from './money';
import { PayPeriodSchema } from './pay-periods';

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

const signedCents = z.number().int();
const count = z.number().int().min(0);

/**
 * Her share of one currency, over a day or a fortnight (ADR 0106 § 15 to § 19): the sum of the platform's own
 * `creatorMinor` (Reveal's `modelRevenue`), refunds taken off, never computed again nor converted. `refundedMinor` is
 * what the refunds took off it, for the detail she unfolds; never the fan, the seller nor the agency's share.
 */
export const CreatorEarningsSumSchema = z.strictObject({
  currency: CurrencySchema,
  shareMinor: signedCents,
  sales: count,
  refunds: count,
  refundedMinor: z.number().int().min(0),
});
export type CreatorEarningsSum = z.infer<typeof CreatorEarningsSumSchema>;

/** One day of her calendar, in her own zone, and its sums by currency. */
export const CreatorEarningsDaySchema = z.strictObject({
  day: z.iso.date(),
  sums: z.array(CreatorEarningsSumSchema).min(1),
});
export type CreatorEarningsDay = z.infer<typeof CreatorEarningsDaySchema>;

/**
 * One fortnight of the team's pay (from the 1st to the 15th, from the 16th to the month's end), bounded in the
 * agency's zone as pay is, so that its total is what pay reads, up to the agency's today when it is the one in course.
 * `totals` by currency, then her days with a sale or a refund, newest first, each sale on its day in HER zone: near a
 * bound, a day may be one past the fortnight's. `refundsWithoutSale` counts the refunds of those days whose sale is
 * older than the register: in no sum.
 */
export const CreatorEarningsPeriodSchema = z.strictObject({
  from: PayPeriodSchema,
  to: z.iso.date(),
  totals: z.array(CreatorEarningsSumSchema),
  days: z.array(CreatorEarningsDaySchema),
  refundsWithoutSale: count,
});
export type CreatorEarningsPeriod = z.infer<typeof CreatorEarningsPeriodSchema>;

/**
 * `GET /v1/creator-space/earnings` (creator, ADR 0106 amendment of 16/11): her share, the fortnight in course then the
 * one before, her days in `timeZone`, her own, and `today` her day there. Read on her view `creator_sales` through her account, never a request.
 */
export const CreatorEarningsSchema = z.strictObject({
  timeZone: z.string().min(1),
  today: z.iso.date(),
  periods: z.array(CreatorEarningsPeriodSchema).length(2),
});
export type CreatorEarnings = z.infer<typeof CreatorEarningsSchema>;
