import { z } from 'zod';

import { IsoDaySchema } from './agent-hours';
import { refusalBodySchema } from './errors';
import { GuardCodeSchema } from './guards';
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
 * What a slot's post is for (ADR 0080 § 1.5): the main post, a media and the link that leads to her platform, one a
 * day at most; or a post of engagement, a question, a moment or a poll, without a link.
 */
export const ChannelSlotRoleSchema = z.enum(['main', 'engagement']);
export type ChannelSlotRole = z.infer<typeof ChannelSlotRoleSchema>;

/** The main post's hour (Charles, 08/11/2026): a slot stored before roles existed is the main one at 19 h. */
export const CHANNEL_MAIN_MINUTE = 19 * 60;

/**
 * A slot: an hour on her clock and the days it goes out (ADR 0080 § 1.1), switched off without being deleted. The
 * days are kept sorted and distinct.
 */
export const ChannelSlotSchema = z.object({
  minute: MinuteOfDaySchema,
  role: ChannelSlotRoleSchema,
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

export const LINK_DESTINATION_MAX = 120;

/**
 * A redirect link of hers (ADR 0080 § 4): a name the agency gives it, its address, and where it leads in a few words
 * (« mon live TikTok ce soir 21 h ») for the post to speak of that place (§ 4.5). Empty: the post names no place.
 */
export const RedirectLinkSchema = z.object({
  id: RedirectLinkIdSchema,
  name: z.string().trim().min(1, 'Donne-lui un nom').max(60),
  url: RedirectUrlSchema,
  destination: z
    .string()
    .trim()
    .max(LINK_DESTINATION_MAX)
    .refine((text) => !labelHasAddress(text), 'Où il mène se dit sans adresse')
    .default(''),
});
export type RedirectLink = z.infer<typeof RedirectLinkSchema>;

/**
 * Whether the words of a link hold an address (ADR 0080 § 4.3): a scheme, `www.`, or a bare domain such as `bit.ly/x`
 * or `t.me`. The address of a post is the code's, never the text's.
 */
export function labelHasAddress(text: string): boolean {
  // A domain ends where letters and digits stop (« tiktok.com, », « (t.me) », « café.fr »). Its ending is in lower case
  // as people type one: « Reveal.Viens », « St.Valentin » are sentences, « mon Reveal.me » is an address.
  return /[Hh][Tt][Tt][Pp][Ss]?:\/\/|[Ww][Ww][Ww]\.|[\p{L}\p{N}-]+\.[a-z]{2,}(?![\p{L}\p{N}-])/u.test(text);
}

/** ADR 0080 § 5.5: the agency's example posts the prompt reads, ten at most, each a Telegram caption at most. */
export const CHANNEL_EXAMPLES_MAX = 10;
export const CHANNEL_EXAMPLE_MAX = 1000;
export const ChannelExampleSchema = z
  .string()
  .trim()
  .min(1, 'Un exemple vide')
  .max(CHANNEL_EXAMPLE_MAX, `${String(CHANNEL_EXAMPLE_MAX)} caractères au plus`);

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
    /**
     * Her channel's posts the agency chose as examples (ADR 0080 § 5.5), real text kept in the base only, never in the
     * repository. Absent from a setting saved before: none.
     */
    examples: z.array(ChannelExampleSchema).max(CHANNEL_EXAMPLES_MAX).default([]),
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
  slots: [{ minute: CHANNEL_MAIN_MINUTE, role: 'main', days: [1, 2, 3, 4, 5, 6, 7], enabled: true }],
  previewMinutes: 60,
  publishWithoutValidation: true,
  linkForm: 'label',
  linkLabel: 'Viens me parler ✨',
  links: [],
  channelLinkId: null,
  examples: [],
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
  'two_main_posts',
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

/**
 * A post of her channel tried in the playground (ADR 0080 § 7, mode « Post du canal »): the main post (§ 5.8), a post
 * of engagement, or a poll (§ 5.7), written by the same path as production, never sent.
 * `POST /v1/creators/:creatorId/telegram-channel/try`.
 */
export const ChannelPostKindSchema = z.enum(['main', 'engagement', 'poll']);
export type ChannelPostKind = z.infer<typeof ChannelPostKindSchema>;

export const CHANNEL_MEDIA_TEXT_MAX = 600;
export const CHANNEL_ADVICE_MAX = 500;
/** Telegram: a poll's question holds 300 characters, an answer 100; kept shorter, as she would write them. */
export const CHANNEL_POLL_QUESTION_MAX = 200;
export const CHANNEL_POLL_OPTION_MAX = 60;
export const CHANNEL_POLL_OPTIONS_MIN = 2;
export const CHANNEL_POLL_OPTIONS_MAX = 4;

export const TryChannelPostBodySchema = z.object({
  kind: ChannelPostKindSchema,
  /** The media the post goes with, described in words; null: a text alone. */
  media: z.string().trim().min(1).max(CHANNEL_MEDIA_TEXT_MAX).nullable(),
  /** The agency's advice (§ 2.3), a subject, an angle, a piece of news; null: none. */
  advice: z.string().trim().min(1).max(CHANNEL_ADVICE_MAX).nullable(),
  /** One of her links for this post only (§ 4.6); null: the channel's link. Only the main post carries one. */
  linkId: RedirectLinkIdSchema.nullable(),
});
export type TryChannelPostBody = z.infer<typeof TryChannelPostBodySchema>;

/** A piece of a post's text as Telegram shows it: the voice marks bold and underline, the code renders them. */
export const ChannelTextSegmentSchema = z.object({
  text: z.string(),
  style: z.enum(['plain', 'bold', 'underline']),
});
export type ChannelTextSegment = z.infer<typeof ChannelTextSegmentSchema>;

export const ChannelPostDraftSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('post'),
    segments: z.array(ChannelTextSegmentSchema),
    /** The link the code adds at the end, as it reads; null when the channel has none. */
    link: z.object({ text: z.string().min(1), url: z.string().min(1), name: z.string().min(1) }).nullable(),
    /** The message as sent to Telegram (`parse_mode` HTML), escaped by the code. */
    html: z.string(),
  }),
  z.object({
    kind: z.literal('poll'),
    question: z.string().min(1).max(CHANNEL_POLL_QUESTION_MAX),
    options: z
      .array(z.string().min(1).max(CHANNEL_POLL_OPTION_MAX))
      .min(CHANNEL_POLL_OPTIONS_MIN)
      .max(CHANNEL_POLL_OPTIONS_MAX),
  }),
]);
export type ChannelPostDraft = z.infer<typeof ChannelPostDraftSchema>;

/** A guard the draft meets (§ 5.4): a blocking one keeps it from going out. */
export const ChannelPostViolationSchema = z.object({
  code: GuardCodeSchema,
  blocking: z.boolean(),
  match: z.string().nullable(),
});
export type ChannelPostViolation = z.infer<typeof ChannelPostViolationSchema>;

export const TriedChannelPostSchema = z.object({
  draft: ChannelPostDraftSchema,
  violations: z.array(ChannelPostViolationSchema),
  /** Her persona version that wrote it, as the playground names it. */
  personaVersion: z.string().min(1),
});
export type TriedChannelPost = z.infer<typeof TriedChannelPostSchema>;

/** Why a try is refused (400). */
export const ChannelTryRefusalKindSchema = z.enum(['no_persona', 'link_unknown', 'llm_unavailable']);
export type ChannelTryRefusalKind = z.infer<typeof ChannelTryRefusalKindSchema>;
export const TELEGRAM_CHANNEL_TRY_REFUSED = 'telegram_channel_try_invalid';
export const ChannelTryRefusalBodySchema = refusalBodySchema(ChannelTryRefusalKindSchema);
