import { z } from 'zod';

import { refusalBodySchema } from './errors';
import { pastedSecret } from './pasted-secret';

/**
 * The bots that post in the creators' channels, managed from Réglages › Telegram (ADR 0020, ADR 0080). Since
 * 27/11/2026 Telegram serves the channels only: no alert group, no routing. A bot token never crosses the API outwards:
 * only what Telegram says about the bot and the chats it sits in.
 */

const uuid = z.uuid();

export const TelegramBotIdSchema = uuid.brand<'TelegramBotId'>();
export type TelegramBotId = z.infer<typeof TelegramBotIdSchema>;

export const TelegramChatIdSchema = uuid.brand<'TelegramChatId'>();
export type TelegramChatId = z.infer<typeof TelegramChatIdSchema>;

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

/** `GET /v1/settings/telegram`: the bots and the chats each sits in. */
export const TelegramOverviewSchema = z.object({ bots: z.array(TelegramBotSchema) });
export type TelegramOverview = z.infer<typeof TelegramOverviewSchema>;

/** A bot token is `<digits>:<35 characters>`; 128 leaves room and stops abuse of the route. */
export const SaveTelegramTokenBodySchema = z.object({ token: pastedSecret(128) });
export type SaveTelegramTokenBody = z.infer<typeof SaveTelegramTokenBodySchema>;

export const TelegramRefusalSchema = z.object({ kind: TelegramErrorKindSchema, message: z.string().min(1) });
export type TelegramRefusal = z.infer<typeof TelegramRefusalSchema>;

/** A token Telegram or the shape check refused (422: adding a bot, replacing its token), in the common body (MOT-13). */
export const TELEGRAM_TOKEN_UNPROCESSABLE = 'telegram_token_unprocessable';
export const TelegramRefusalBodySchema = refusalBodySchema(TelegramErrorKindSchema);

/** Jobs of the module (ADR 0006), part of `JOB_NAMES` and `JOB_PAYLOADS` (jobs.ts). */
export const TELEGRAM_JOB_PAYLOADS = {
  'telegram.dispatch_polls': z.object({}),
  'telegram.poll_updates': z.object({
    botId: TelegramBotIdSchema,
    /** Long poll while the screen waits for a channel; 0 for the minute round. */
    waitSeconds: z.number().int().min(0).max(25),
  }),
} as const;
