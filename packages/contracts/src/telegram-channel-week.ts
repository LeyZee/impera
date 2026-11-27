import { z } from 'zod';

import { refusalBodySchema } from './errors';
import { CreatorIdSchema } from './ids';
import { MinuteOfDaySchema } from './scheduling';
import { ChannelPostDraftSchema, ChannelSlotRoleSchema, CHANNEL_ADVICE_MAX } from './telegram-channel';

/**
 * Her channel's week, planned ahead and reviewed by two (ADR 0162): each post of the week has its hour drawn in its
 * window, its role, its kind and its theme, then a text; the owner and the creator may validate, edit, rewrite,
 * change its visual or remove it, and a post nobody read goes out at its hour all the same.
 * `GET /v1/creators/:creatorId/telegram-channel/week?week=YYYY-MM-DD` and the gestures under `.../posts/:postId`.
 */

/** A calendar day, `YYYY-MM-DD`; a week is named by its Monday. */
export const ChannelDaySchema = z.iso.date();
export type ChannelDay = z.infer<typeof ChannelDaySchema>;

export const ChannelPlannedPostIdSchema = z.uuid().brand<'ChannelPlannedPostId'>();
export type ChannelPlannedPostId = z.infer<typeof ChannelPlannedPostIdSchema>;

/**
 * What a post is made of (ADR 0162 § 1): a text alone, a text with a photo of her Telegram stock, a poll, or the main
 * post of the evening (a public visual and the link).
 */
export const ChannelPlannedKindSchema = z.enum(['text', 'photo', 'poll', 'main']);
export type ChannelPlannedKind = z.infer<typeof ChannelPlannedKindSchema>;

/**
 * What a post talks about, chosen by the code for variety (ADR 0162 § 1.3): a girl's question (an outfit, a make-up),
 * her opinion on one of her passions and its news, the wish to chat, a small piece of news from a real source, a poll,
 * the evening's call to come.
 */
export const ChannelThemeSchema = z.enum(['girly', 'passion', 'chat', 'news', 'poll', 'evening']);
export type ChannelTheme = z.infer<typeof ChannelThemeSchema>;

/**
 * Where a post stands. `planned`: waits for its hour; `sent`: Telegram took it; `removed`: taken out in the review (a
 * replacement takes its place); `skipped`: its hour passed without anything to send (no visual, a guard refused
 * twice), said in amber; `failed`: Telegram refused it, or its answer was lost (never sent again).
 */
export const ChannelPostStateSchema = z.enum(['planned', 'sent', 'removed', 'skipped', 'failed']);
export type ChannelPostState = z.infer<typeof ChannelPostStateSchema>;

/** The last hand on a post in the review (§ 3.3), as the screen says it: « Validé par Charles », « Modifié par Lou ». */
export const ChannelReviewSchema = z.object({
  action: z.enum(['validated', 'edited', 'rewritten', 'visual_changed', 'removed']),
  byName: z.string().min(1),
  at: z.iso.datetime(),
});
export type ChannelReview = z.infer<typeof ChannelReviewSchema>;

export const ChannelPlannedPostSchema = z.object({
  id: ChannelPlannedPostIdSchema,
  creatorId: CreatorIdSchema,
  day: ChannelDaySchema,
  /** Its window on her clock (§ 2.1), and the hour drawn in it, fixed and shown (§ 2.2). */
  window: z.object({ from: MinuteOfDaySchema, until: MinuteOfDaySchema }),
  at: z.iso.datetime(),
  role: ChannelSlotRoleSchema,
  kind: ChannelPlannedKindSchema,
  theme: ChannelThemeSchema,
  /** Null while the text is not written yet (or failed to be). */
  draft: ChannelPostDraftSchema.nullable(),
  /** The visual chosen for it, from what the code allows (§ 5.2); null for a text alone or a poll. */
  mediaId: z.uuid().nullable(),
  /** Why the voice chose this visual, one line shown in the review (§ 5.2). */
  why: z.string().nullable(),
  /** An old post of the channel sent again (§ 6), said in the review. */
  repost: z.boolean(),
  state: ChannelPostStateSchema,
  /** Validated, edited by hand or rewritten on advice: the code never rewrites it again (§ 3.6). */
  locked: z.boolean(),
  review: ChannelReviewSchema.nullable(),
  /** The post it replaces, removed in the review (§ 3.4). */
  replacesId: ChannelPlannedPostIdSchema.nullable(),
  /** Why it was skipped or failed, in words, for the amber line. */
  reason: z.string().nullable(),
  sentAt: z.iso.datetime().nullable(),
});
export type ChannelPlannedPost = z.infer<typeof ChannelPlannedPostSchema>;

export const ChannelWeekSchema = z.object({
  week: ChannelDaySchema,
  /** Every post of the week, removed ones included, by hour. */
  posts: z.array(ChannelPlannedPostSchema),
  /** Read by someone: validated, edited, rewritten or visual changed; out of the posts that count (not removed). */
  reviewed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type ChannelWeek = z.infer<typeof ChannelWeekSchema>;

export const ChannelWeekQuerySchema = z.object({ week: ChannelDaySchema });
export type ChannelWeekQuery = z.infer<typeof ChannelWeekQuerySchema>;

/** Telegram: a caption with a media holds 1 024 characters, the link included; a text alone 4 096. */
export const CHANNEL_EDIT_MAX = 1000;

/** A gesture of the review (§ 3.3), one at a time, up to the post's hour. */
export const ChannelPostGestureSchema = z.discriminatedUnion('gesture', [
  z.object({ gesture: z.literal('validate') }),
  z.object({ gesture: z.literal('edit'), text: z.string().trim().min(1).max(CHANNEL_EDIT_MAX) }),
  z.object({
    gesture: z.literal('rewrite'),
    advice: z.string().trim().min(1).max(CHANNEL_ADVICE_MAX).nullable(),
  }),
  z.object({ gesture: z.literal('change_visual') }),
  z.object({ gesture: z.literal('remove') }),
]);
export type ChannelPostGesture = z.infer<typeof ChannelPostGestureSchema>;

/** Why a gesture is refused (400): its hour has passed, it is already out or removed, or nothing else is allowed. */
export const ChannelGestureRefusalKindSchema = z.enum([
  'too_late',
  'not_planned',
  'no_other_visual',
  'not_a_text',
  'llm_unavailable',
  'guarded',
]);
export type ChannelGestureRefusalKind = z.infer<typeof ChannelGestureRefusalKindSchema>;
export const TELEGRAM_CHANNEL_GESTURE_REFUSED = 'telegram_channel_gesture_invalid';
export const ChannelGestureRefusalBodySchema = refusalBodySchema(ChannelGestureRefusalKindSchema);
