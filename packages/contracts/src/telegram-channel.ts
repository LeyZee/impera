import { z } from 'zod';

import { IsoDaySchema } from './agent-hours';
import { refusalBodySchema } from './errors';
import { CreatorIdSchema } from './ids';
import { MinuteOfDaySchema } from './scheduling';
import { TelegramChatIdSchema, TelegramMembershipSchema } from './telegram';

/**
 * The creator's Telegram channel (ADR 0057, ADR 0080 § 1, § 4 and § 6): which channel the agency's bot posts in for
 * her, the slots when a post goes out on its own, how long before it is shown to the agency, and the redirect links
 * the code adds at the end of each post. `GET` and `PUT /v1/creators/:creatorId/telegram-channel`, the owner's alone.
 */

/** ADR 0080 § 1.1: at most four posts a day. */
export const CHANNEL_POSTS_PER_DAY_MAX = 4;
/** ADR 0080 § 1.3: two slots of one day are three hours apart at least. */
export const CHANNEL_SLOT_GAP_MINUTES = 180;
export const CHANNEL_SLOTS_MAX = 12;
export const REDIRECT_LINKS_MAX = 20;
/** ADR 0080 § 2.2: the preview window, from 15 minutes to 4 hours. */
export const CHANNEL_PREVIEW_MIN = 15;
export const CHANNEL_PREVIEW_MAX = 240;
/** ADR 0080 § 4.2: a whole `https://` address, no space, 2 048 characters at most. */
export const REDIRECT_URL_MAX = 2048;

/**
 * A slot: an hour on her clock and the days it goes out (ADR 0080 § 1.1), switched off without being deleted. The
 * days are kept sorted and distinct.
 */
export const ChannelSlotSchema = z.object({
  minute: MinuteOfDaySchema,
  days: z
    .array(IsoDaySchema)
    .min(1, 'Choisis au moins un jour')
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Un jour en double'),
  enabled: z.boolean(),
});
export type ChannelSlot = z.infer<typeof ChannelSlotSchema>;

export const RedirectLinkIdSchema = z.uuid().brand<'RedirectLinkId'>();
export type RedirectLinkId = z.infer<typeof RedirectLinkIdSchema>;

/**
 * Whether an address is one the code may add to a post (ADR 0080 § 4.2): `https://`, a host, no space, no user or
 * password before the host. Nothing is said of where it leads: that is the redirect service's.
 */
export function isRedirectUrl(text: string): boolean {
  if (text.length > REDIRECT_URL_MAX || /\s/u.test(text) || !text.startsWith('https://')) return false;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' && url.hostname.includes('.') && url.username === '' && url.password === ''
  );
}

export const RedirectUrlSchema = z
  .string()
  .trim()
  .refine(isRedirectUrl, 'Une adresse complète qui commence par https://, sans espace');

/** A redirect link of hers (ADR 0080 § 4.1): a name the agency gives it and its address. */
export const RedirectLinkSchema = z.object({
  id: RedirectLinkIdSchema,
  name: z.string().trim().min(1, 'Donne-lui un nom').max(60),
  url: RedirectUrlSchema,
});
export type RedirectLink = z.infer<typeof RedirectLinkSchema>;

/**
 * Whether the words of a link hold an address (ADR 0080 § 4.3): a scheme, `www.`, or a bare domain such as `bit.ly/x`
 * or `t.me`. The address of a post is the code's, never the text's.
 */
export function labelHasAddress(text: string): boolean {
  return /https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}(?:\/|$|\s)/iu.test(text);
}

/** ADR 0080 § 4.3: a short text that carries the link, or the bare address. */
export const ChannelLinkFormSchema = z.enum(['label', 'bare']);
export type ChannelLinkForm = z.infer<typeof ChannelLinkFormSchema>;

/** What the owner sets; stored whole, read whole. */
export const TelegramChannelConfigSchema = z
  .object({
    /** The channel, one of those where the agency's bot sits (`telegram_chats`, kind `channel`); null until chosen. */
    chatId: TelegramChatIdSchema.nullable(),
    slots: z.array(ChannelSlotSchema).max(CHANNEL_SLOTS_MAX),
    previewMinutes: z.number().int().min(CHANNEL_PREVIEW_MIN).max(CHANNEL_PREVIEW_MAX),
    /** ADR 0080 § 2.6: on, a post goes out at its hour unless stopped; off, it waits for « Valider ». */
    publishWithoutValidation: z.boolean(),
    linkForm: ChannelLinkFormSchema,
    /** The words that carry the link when `linkForm` is `label`; never an address. */
    /** Kept while `linkForm` is `bare`, so that going back to `label` finds it; required only for `label`. */
    linkLabel: z
      .string()
      .trim()
      .max(60)
      .refine((text) => !labelHasAddress(text), 'Le texte du lien ne contient pas d’adresse'),
    links: z.array(RedirectLinkSchema).max(REDIRECT_LINKS_MAX),
    /** The link of the channel, one of `links`; null: no post goes out (ADR 0080 § 4.4). */
    channelLinkId: RedirectLinkIdSchema.nullable(),
  })
  .superRefine((config, ctx) => {
    if (config.linkForm === 'label' && config.linkLabel === '') {
      ctx.addIssue({ code: 'custom', path: ['linkLabel'], message: 'Écris le texte du lien' });
    }
    const ids = new Set<string>();
    config.links.forEach((link, rank) => {
      if (ids.has(link.id))
        ctx.addIssue({ code: 'custom', path: ['links', rank, 'id'], message: 'Id de lien en double' });
      ids.add(link.id);
    });
  });
export type TelegramChannelConfig = z.infer<typeof TelegramChannelConfigSchema>;

/** 19 h every day, shown an hour before, out on its own (Charles, 07/11/2026 12h26). */
export const DEFAULT_TELEGRAM_CHANNEL_CONFIG: TelegramChannelConfig = {
  chatId: null,
  slots: [{ minute: 19 * 60, days: [1, 2, 3, 4, 5, 6, 7], enabled: true }],
  previewMinutes: 60,
  publishWithoutValidation: true,
  linkForm: 'label',
  linkLabel: 'Viens me parler ✨',
  links: [],
  channelLinkId: null,
};

/** A channel the agency's bot sits in, as the screen offers it. */
export const ChannelChoiceSchema = z.object({
  chatId: TelegramChatIdSchema,
  title: z.string().min(1),
  membership: TelegramMembershipSchema,
  /** The bot is an administrator allowed to post. */
  canPost: z.boolean(),
  /** Another creator's channel already: not offered to her. */
  takenByOther: z.boolean(),
  /** A group of the alerts' routing points at it: refused, alerts never go to a public channel. */
  routedForAlerts: z.boolean(),
});
export type ChannelChoice = z.infer<typeof ChannelChoiceSchema>;

/** What keeps her posts from going out, as the screen says it in amber (ADR 0080 § 4.4, § 6.1). */
export const ChannelWarningSchema = z.enum([
  'no_bot',
  'no_channel',
  'channel_gone',
  'bot_cannot_post',
  'no_link',
  'no_slot',
]);
export type ChannelWarning = z.infer<typeof ChannelWarningSchema>;

export const TelegramChannelViewSchema = z.object({
  creatorId: CreatorIdSchema,
  config: TelegramChannelConfigSchema,
  /** False until the owner saved once: the config is then the defaults. */
  saved: z.boolean(),
  channels: z.array(ChannelChoiceSchema),
  warnings: z.array(ChannelWarningSchema),
});
export type TelegramChannelView = z.infer<typeof TelegramChannelViewSchema>;

export const SaveTelegramChannelBodySchema = z.object({ config: TelegramChannelConfigSchema });
export type SaveTelegramChannelBody = z.infer<typeof SaveTelegramChannelBodySchema>;

/** Why a save is refused (400), the slot or the link named by its rank on screen when there is one. */
export const ChannelRefusalKindSchema = z.enum([
  'too_many_posts',
  'slots_too_close',
  'link_name_taken',
  'link_url_taken',
  'channel_link_unknown',
  'chat_unknown',
  'chat_not_channel',
  'chat_taken',
  'chat_routed',
]);
export type ChannelRefusalKind = z.infer<typeof ChannelRefusalKindSchema>;

export const ChannelRefusalSchema = z.object({ kind: ChannelRefusalKindSchema, message: z.string().min(1) });
export type ChannelRefusal = z.infer<typeof ChannelRefusalSchema>;

/** `PUT` refused (400), in the common body (MOT-13). */
export const TELEGRAM_CHANNEL_INVALID = 'telegram_channel_invalid';
export const TelegramChannelRefusalBodySchema = refusalBodySchema(ChannelRefusalKindSchema);
