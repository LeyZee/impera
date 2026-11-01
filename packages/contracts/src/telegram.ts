import { z } from 'zod';

import { CreatorIdSchema } from './ids';

/**
 * Telegram notifications managed from Réglages › Telegram (ADR 0020, task P3-07). A bot token never crosses the
 * API outwards: only what Telegram says about the bot and the groups it sits in.
 */

const uuid = z.uuid();

export const TelegramBotIdSchema = uuid.brand<'TelegramBotId'>();
export type TelegramBotId = z.infer<typeof TelegramBotIdSchema>;

export const TelegramChatIdSchema = uuid.brand<'TelegramChatId'>();
export type TelegramChatId = z.infer<typeof TelegramChatIdSchema>;

/** One per tab topic; the three alert levels first (ADR 0020 §2). `custom`: her own alerts, one topic for all (P4-01). */
export const TelegramTopicSchema = z.enum([
  'urgent',
  'important',
  'info',
  'sale',
  'keyword',
  'validation',
  'custom',
]);
export type TelegramTopic = z.infer<typeof TelegramTopicSchema>;

/** `refused`: Telegram turned the token down (revoked). `conflict`: another program reads the same token. */
export const TelegramBotStateSchema = z.enum(['active', 'refused', 'conflict']);
export type TelegramBotState = z.infer<typeof TelegramBotStateSchema>;

export const TelegramChatKindSchema = z.enum(['group', 'supergroup', 'channel']);
export type TelegramChatKind = z.infer<typeof TelegramChatKindSchema>;

export const TelegramMembershipSchema = z.enum(['member', 'left', 'kicked']);
export type TelegramMembership = z.infer<typeof TelegramMembershipSchema>;

/**
 * `DELETE /v1/settings/telegram/chats/:id` (REG-28) while the bot still sits in the group (409): only a group it left
 * (`left`) or was banned from (`kicked`) leaves the list.
 */
export const TELEGRAM_CHAT_MEMBER_CONFLICT = 'telegram_chat_member_conflict';

/** Why Telegram or the shape check said no; each kind has exactly one French sentence (module `telegram`). */
export const TelegramErrorKindSchema = z.enum([
  'token_shape',
  'token_refused',
  'bot_exists',
  'bot_mismatch',
  'bot_conflict',
  'chat_unreachable',
  'rate_limited',
  'unreachable',
  'routes_version_conflict',
  /** A message still waiting when its group was removed from the list (REG-28): it never left. */
  'chat_removed',
]);
export type TelegramErrorKind = z.infer<typeof TelegramErrorKindSchema>;

export const TelegramChatSchema = z.object({
  id: TelegramChatIdSchema,
  title: z.string().min(1),
  kind: TelegramChatKindSchema,
  membership: TelegramMembershipSchema,
  canPost: z.boolean(),
  lastSentAt: z.iso.datetime().nullable(),
  /** The one sentence the line shows when the last delivery failed. */
  lastError: z.string().min(1).nullable(),
});
export type TelegramChat = z.infer<typeof TelegramChatSchema>;

export const TelegramBotSchema = z.object({
  id: TelegramBotIdSchema,
  username: z.string().min(1),
  displayName: z.string().min(1),
  state: TelegramBotStateSchema,
  lastPolledAt: z.iso.datetime().nullable(),
  chats: z.array(TelegramChatSchema),
});
export type TelegramBot = z.infer<typeof TelegramBotSchema>;

/** `creatorId: null` sends the topic of every creator to the group. */
export const TelegramRouteSchema = z.object({
  creatorId: CreatorIdSchema.nullable(),
  topic: TelegramTopicSchema,
  chatId: TelegramChatIdSchema,
});
export type TelegramRoute = z.infer<typeof TelegramRouteSchema>;

/** Per active creator: can an urgent alert reach a group right now (ADR 0020 §12). */
export const TelegramCoverageSchema = z.array(
  z.object({
    creatorId: CreatorIdSchema,
    displayName: z.string().min(1),
    urgentReachable: z.boolean(),
    topicsWithoutGroup: z.array(TelegramTopicSchema),
  }),
);
export type TelegramCoverage = z.infer<typeof TelegramCoverageSchema>;

export const TelegramOverviewSchema = z.object({
  bots: z.array(TelegramBotSchema),
  routes: z.array(TelegramRouteSchema),
  coverage: TelegramCoverageSchema,
  /** Optimistic concurrency of the routing table: sent back with `PUT /routes`. */
  version: z.number().int().min(0),
});
export type TelegramOverview = z.infer<typeof TelegramOverviewSchema>;

/** A bot token is `<digits>:<35 characters>`; 128 leaves room and stops abuse of the route. */
export const SaveTelegramTokenBodySchema = z.object({ token: z.string().trim().min(1).max(128) });
export type SaveTelegramTokenBody = z.infer<typeof SaveTelegramTokenBodySchema>;

export const SaveTelegramRoutesBodySchema = z.object({
  version: z.number().int().min(0),
  routes: z.array(TelegramRouteSchema).max(500),
});
export type SaveTelegramRoutesBody = z.infer<typeof SaveTelegramRoutesBodySchema>;

export const TelegramRoutesSchema = z.object({
  routes: z.array(TelegramRouteSchema),
  version: z.number().int(),
});

export const TelegramRefusalSchema = z.object({ kind: TelegramErrorKindSchema, message: z.string().min(1) });
export type TelegramRefusal = z.infer<typeof TelegramRefusalSchema>;

export const TelegramTestResultSchema = z.object({ sentAt: z.iso.datetime() });

export const TelegramDeliveryStatusSchema = z.enum(['pending', 'sending', 'sent', 'failed', 'unknown']);
export type TelegramDeliveryStatus = z.infer<typeof TelegramDeliveryStatusSchema>;

/** A line of the « Dernières alertes » journal. The text is written by the code, never a fan's words. */
export const TelegramDeliverySchema = z.object({
  id: z.uuid(),
  topic: TelegramTopicSchema,
  creatorId: CreatorIdSchema.nullable(),
  chatTitle: z.string().min(1),
  summary: z.string().min(1),
  status: TelegramDeliveryStatusSchema,
  createdAt: z.iso.datetime(),
  sentAt: z.iso.datetime().nullable(),
  /** « Pris en main par Théo », once someone took the conversation. */
  closedBy: z.string().min(1).nullable(),
});
export type TelegramDelivery = z.infer<typeof TelegramDeliverySchema>;

export const TelegramDeliveriesSchema = z.object({ deliveries: z.array(TelegramDeliverySchema) });

/** Alert counts of one night, for the Dashboard's guards card. */
export const TelegramNightCountsSchema = z.object({
  urgent: z.number().int().min(0),
  important: z.number().int().min(0),
  info: z.number().int().min(0),
});
export type TelegramNightCounts = z.infer<typeof TelegramNightCountsSchema>;

/** Jobs of the module (ADR 0006), part of `JOB_NAMES` and `JOB_PAYLOADS` (jobs.ts). */
export const TELEGRAM_JOB_PAYLOADS = {
  'telegram.scan': z.object({}),
  'telegram.flush_chat': z.object({ chatId: TelegramChatIdSchema }),
  'telegram.dispatch_polls': z.object({}),
  'telegram.poll_updates': z.object({
    botId: TelegramBotIdSchema,
    /** Long poll while the screen waits for a group; 0 for the minute round. */
    waitSeconds: z.number().int().min(0).max(25),
  }),
  'telegram.morning_digest': z.object({}),
  'telegram.purge': z.object({}),
} as const;
