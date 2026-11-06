import {
  CreatorIdSchema,
  InstagramHandleSchema,
  InstagramPostCodeSchema,
  TREND_CAPTION_MAX,
  TREND_HASHTAGS_MAX,
  TrendMetricsSchema,
} from '@impera/contracts';
import { z } from 'zod';

/**
 * The messages between the watch's three parts (VEI-02): the reader on instagram.com, the service worker, the popup.
 * Each side parses what it receives (Zod at the boundary): a message is data, never trusted for its shape.
 */

/** One post as the reader saw it in this session: what the page showed, the time it stayed on screen. */
const SeenPostSchema = z.strictObject({
  code: InstagramPostCodeSchema,
  path: z.enum(['post', 'reel']),
  account: InstagramHandleSchema.nullable(),
  metrics: TrendMetricsSchema,
  caption: z.string().max(TREND_CAPTION_MAX).nullable(),
  hashtags: z.array(z.string().min(1).max(100)).max(TREND_HASHTAGS_MAX),
  sound: z.string().min(1).max(200).nullable(),
  soundId: z
    .string()
    .regex(/^\d{1,32}$/u)
    .nullable(),
  dwellMs: z
    .number()
    .int()
    .min(0)
    .max(45 * 60_000),
  seenAt: z.iso.datetime(),
});
export type SeenPost = z.infer<typeof SeenPostSchema>;

/** The post on screen when the person marks: its code, and its video's length when one shows. */
const OnScreenSchema = z.strictObject({
  post: SeenPostSchema,
  durationS: z.number().positive().max(3_600).nullable(),
});
export type OnScreen = z.infer<typeof OnScreenSchema>;

/** Reader → service worker. */
export const FromReaderSchema = z.discriminatedUnion('type', [
  /** The reader starts in a tab and asks whether its tab is watched. */
  z.strictObject({ type: z.literal('watch/hello') }),
  /** The posts whose reading changed since the last message, at most fifty. */
  z.strictObject({ type: z.literal('watch/seen'), posts: z.array(SeenPostSchema).min(1).max(50) }),
  /** Amber: post links on a read page, and nothing read of them for a while (Instagram changed its page). */
  z.strictObject({ type: z.literal('watch/health'), amber: z.boolean() }),
]);
export type FromReader = z.infer<typeof FromReaderSchema>;

export const HelloAnswerSchema = z.strictObject({ watching: z.boolean() });

/** Service worker → reader. */
export const ToReaderSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('watch/start') }),
  z.strictObject({ type: z.literal('watch/stop') }),
  /** Which post is on screen now; null when none is (a grid, a page still loading). */
  z.strictObject({ type: z.literal('watch/on-screen') }),
]);
export type ToReader = z.infer<typeof ToReaderSchema>;

export const OnScreenAnswerSchema = z.strictObject({ onScreen: OnScreenSchema.nullable() });

/** What the popup shows of the watch in the open tab. */
export const WatchStatusSchema = z.strictObject({
  /** The browser lets the extension read instagram.com (asked at the first « Veille »). */
  allowed: z.boolean(),
  link: z.enum(['none', 'linked', 'revoked']),
  watch: z
    .strictObject({
      startedAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      posts: z.number().int().min(0),
      marked: z.number().int().min(0),
      amber: z.boolean(),
    })
    .nullable(),
  /** The last marking's description: described, the cap of the day spent, no vision; null before any. */
  vision: z.enum(['described', 'budget', 'unavailable', 'failed']).nullable(),
  lastCreatorId: CreatorIdSchema.nullable(),
});
export type WatchStatus = z.infer<typeof WatchStatusSchema>;

export const MarkableCreatorsSchema = z.strictObject({
  state: z.enum(['ok', 'revoked', 'unreachable', 'none']),
  items: z.array(z.strictObject({ id: CreatorIdSchema, displayName: z.string() })),
});
export type MarkableCreators = z.infer<typeof MarkableCreatorsSchema>;

export const LinkSavedSchema = z.strictObject({
  state: z.enum(['linked', 'refused', 'unreachable', 'malformed']),
});
export type LinkSaved = z.infer<typeof LinkSavedSchema>;

export const MarkedSchema = z.strictObject({
  state: z.enum(['marked', 'nothing-on-screen', 'not-watching', 'failed']),
});
export type Marked = z.infer<typeof MarkedSchema>;

/** Popup → service worker. The tab is always the one open when the popup opened. */
export const FromPopupSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('popup/status'), tabId: z.number().int() }),
  z.strictObject({ type: z.literal('popup/begin'), tabId: z.number().int() }),
  z.strictObject({ type: z.literal('popup/end'), tabId: z.number().int() }),
  z.strictObject({ type: z.literal('popup/mark'), tabId: z.number().int(), creatorId: CreatorIdSchema }),
  z.strictObject({ type: z.literal('popup/creators') }),
  /** The code pasted in « Relier »; it goes to the service worker and never comes back to the popup. */
  z.strictObject({ type: z.literal('popup/link'), token: z.string().max(200) }),
  z.strictObject({ type: z.literal('popup/unlink') }),
]);
export type FromPopup = z.infer<typeof FromPopupSchema>;
