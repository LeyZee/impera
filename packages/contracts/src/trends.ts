import { z } from 'zod';

import { DropCategorySchema } from './content-drops';
import {
  ContentIdeaIdSchema,
  CreatorIdSchema,
  TrendReadingIdSchema,
  TrendSignalIdSchema,
  WatchSessionIdSchema,
} from './ids';
import { CalendarDaySchema } from './team-members';

/**
 * The trend watch (ADR 0060, VEI-01): trend signals from six sources, the posts the extension reads while a person
 * watches Instagram, and the content ideas the morning job proposes. Impera keeps a third party's link and public
 * figures, never their media (§ 1), and never asks instagram.com anything: a link is checked by its form, never fetched.
 */

/** The six sources of a signal, each an adapter behind a port of the module (ADR 0060 § 2). */
export const TREND_SIGNAL_SOURCES = [
  /** 1. Her own statistics, by her Instagram connector (ADR 0057). */
  'creator_stats',
  /** 2. Grok's daily search on X and the web, for the whole agency. */
  'grok_search',
  /** 3. A post of a reference account, read by Business Discovery, that stands out from its account. */
  'reference_account',
  /** 4. A link pasted by a member of the agency. */
  'agency_link',
  /** 5. A link pasted by the creator, from her PWA. */
  'creator_link',
  /** 6. A post the extension read while someone watched, marked or standing out (passive capture). */
  'passive_capture',
] as const;
export const TrendSignalSourceSchema = z.enum(TREND_SIGNAL_SOURCES);
export type TrendSignalSource = z.infer<typeof TrendSignalSourceSchema>;

/** What a signal says is rising (ADR 0060 § 2). */
export const TREND_SIGNAL_KINDS = ['format', 'sound', 'theme', 'date'] as const;
export const TrendSignalKindSchema = z.enum(TREND_SIGNAL_KINDS);
export type TrendSignalKind = z.infer<typeof TrendSignalKindSchema>;

/** The format of a post, as the person who pastes a link chooses it, or as the page shows it. */
export const TREND_FORMATS = ['reel', 'photo', 'carousel', 'story'] as const;
export const TrendFormatSchema = z.enum(TREND_FORMATS);
export type TrendFormat = z.infer<typeof TrendFormatSchema>;

/** Default lifetime of a signal (ADR 0060 § 2), an agency setting later; a signal past it is no longer read. */
export const DEFAULT_TREND_SIGNAL_LIFETIME_DAYS = 14;

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** Public figures of a post, each only when the page or the API gave it. */
export const TrendMetricsSchema = z.strictObject({
  views: count.nullable(),
  likes: count.nullable(),
  comments: count.nullable(),
});
export type TrendMetrics = z.infer<typeof TrendMetricsSchema>;

/**
 * The short code of an Instagram post, as its address carries it (`/p/<code>/`, `/reel/<code>/`): the key of a post
 * whatever the path it was seen by.
 */
export const InstagramPostCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{5,64}$/u);
export type InstagramPostCode = z.infer<typeof InstagramPostCodeSchema>;

/** An Instagram user name as the platform allows it: letters, digits, dots and underscores, 30 at most. */
export const InstagramHandleSchema = z.string().regex(/^[A-Za-z0-9._]{1,30}$/u);

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com']);
const POST_PATH = /^\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reels?|tv)\/([A-Za-z0-9_-]{5,64})\/?$/u;

/** A post of Instagram, read from its address alone. */
export interface InstagramPost {
  readonly code: InstagramPostCode;
  /** `reel` for `/reel/`, `/reels/` and `/tv/`, `post` for `/p/`. */
  readonly path: 'post' | 'reel';
  /** The address Impera keeps: no query string (`igsh` and the like say who shared it), no fragment. */
  readonly url: string;
}

/**
 * The post an address names, or null: https only, an Instagram host, a post or a reel path. Read from the text alone,
 * never by asking instagram.com (VEI-01): no preview, no oEmbed, no redirect followed. A profile, a story, the home
 * feed or a shortened link are refused.
 */
export function instagramPostOf(address: string): InstagramPost | null {
  let parsed: URL;
  try {
    parsed = new URL(address.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.port !== '')
    return null;
  if (!INSTAGRAM_HOSTS.has(parsed.hostname.toLowerCase())) return null;
  const match = POST_PATH.exec(parsed.pathname);
  const [, kind, code] = match ?? [];
  if (kind === undefined || code === undefined) return null;
  const path = kind === 'p' ? 'post' : 'reel';
  return {
    code: InstagramPostCodeSchema.parse(code),
    path,
    url: `https://www.instagram.com/${path === 'post' ? 'p' : 'reel'}/${code}/`,
  };
}

/** An address `instagramPostOf` reads, turned into the one Impera keeps. */
export const InstagramPostUrlSchema = z
  .string()
  .max(2048)
  .transform((address, ctx) => {
    const post = instagramPostOf(address);
    if (post === null) {
      ctx.addIssue({ code: 'custom', message: 'not the address of an Instagram post or reel' });
      return z.NEVER;
    }
    return post.url;
  });

/** A trend signal as the module reads it (`trend_signals`). `creatorId` null: for the whole agency (Grok). */
export const TrendSignalSchema = z.strictObject({
  id: TrendSignalIdSchema,
  creatorId: CreatorIdSchema.nullable(),
  source: TrendSignalSourceSchema,
  kind: TrendSignalKindSchema,
  text: z.string().min(1).max(280),
  url: z.string().max(2048).nullable(),
  format: TrendFormatSchema.nullable(),
  metrics: TrendMetricsSchema.nullable(),
  observedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type TrendSignal = z.infer<typeof TrendSignalSchema>;

/** At most this many posts in one batch of readings from the extension. */
export const TREND_READINGS_BATCH_MAX = 50;
export const TREND_CAPTION_MAX = 2200;
export const TREND_HASHTAGS_MAX = 30;

/**
 * One post the extension read (ADR 0060 § 2, source 6): what the page showed, never the media. A post read again in
 * the same watch session updates its figures (key: the session and the post's code, whatever the path).
 */
export const TrendReadingInputSchema = z.strictObject({
  code: InstagramPostCodeSchema,
  path: z.enum(['post', 'reel']),
  account: InstagramHandleSchema.nullable(),
  metrics: TrendMetricsSchema,
  caption: z.string().max(TREND_CAPTION_MAX).nullable(),
  hashtags: z.array(z.string().min(1).max(100)).max(TREND_HASHTAGS_MAX),
  sound: z.string().min(1).max(200).nullable(),
  /**
   * The sound's number in its address (`/reels/audio/<id>/`), when the page showed it: the one key of a sound, since two
   * sounds can share a name and one sound changes name with the language (VEI-02, VEI-03 grid point 6).
   */
  soundId: z
    .string()
    .regex(/^\d{1,32}$/u)
    .nullable(),
  /** Time the post stayed on screen, in this session, in milliseconds. */
  dwellMs: z
    .number()
    .int()
    .min(0)
    .max(45 * 60_000),
  /** The creator the person marked it for, by the extension's gesture; null when only read. */
  markedFor: CreatorIdSchema.nullable(),
  seenAt: z.iso.datetime(),
});
export type TrendReadingInput = z.infer<typeof TrendReadingInputSchema>;

/** The body the extension posts (VEI-02): one watch session, its posts. */
export const TrendReadingsBatchSchema = z.strictObject({
  watchSession: WatchSessionIdSchema,
  readings: z.array(TrendReadingInputSchema).min(1).max(TREND_READINGS_BATCH_MAX),
});
export type TrendReadingsBatch = z.infer<typeof TrendReadingsBatchSchema>;

/** A reading as the server keeps it. */
export const TrendReadingSchema = TrendReadingInputSchema.extend({ id: TrendReadingIdSchema });
export type TrendReading = z.infer<typeof TrendReadingSchema>;

/**
 * `POST` of a pasted link (ADR 0060 § 2, sources 4 and 5): the address of a post, one line, a format, the creator it
 * is for. The server checks the address by its form and never opens it.
 */
export const PasteTrendLinkBodySchema = z.strictObject({
  url: InstagramPostUrlSchema,
  text: z.string().trim().min(1).max(280),
  format: TrendFormatSchema,
  creatorId: CreatorIdSchema,
});
export type PasteTrendLinkBody = z.infer<typeof PasteTrendLinkBodySchema>;

/**
 * Where an idea stands (ADR 0060 §§ 4 and 5): validated by the agency, suggested in her agenda, then a drop. `refused`
 * is the agency's no in « Idées du jour »; `declined` is hers, when she turns the suggestion down in her agenda (CR-05),
 * set by the agenda's event and never by the agenda writing here. Neither is ever proposed again.
 */
export const CONTENT_IDEA_STATES = [
  'proposed',
  'validated',
  'refused',
  'suggested',
  'declined',
  'deposited',
] as const;
export const ContentIdeaStateSchema = z.enum(CONTENT_IDEA_STATES);
export type ContentIdeaState = z.infer<typeof ContentIdeaStateSchema>;

/** The morning job's ceiling, per creator and day (ADR 0060 § 4). */
export const CONTENT_IDEAS_PER_DAY_MAX = 3;

/** What an idea says, as the model writes it and the agency corrects it (ADR 0060 § 4). */
export const ContentIdeaDraftSchema = z.strictObject({
  title: z.string().trim().min(1).max(120),
  category: DropCategorySchema,
  toShoot: z.string().trim().min(1).max(600),
  signalId: TrendSignalIdSchema,
  reason: z.string().trim().min(1).max(200),
  shootMinutes: z.number().int().min(1).max(600),
});
export type ContentIdeaDraft = z.infer<typeof ContentIdeaDraftSchema>;

/** An idea as the module reads it (`content_ideas`). */
export const ContentIdeaSchema = ContentIdeaDraftSchema.extend({
  id: ContentIdeaIdSchema,
  creatorId: CreatorIdSchema,
  state: ContentIdeaStateSchema,
  /** The day it was proposed, in her time zone. */
  proposedOn: CalendarDaySchema,
  refusalReason: z.string().max(280).nullable(),
});
export type ContentIdea = z.infer<typeof ContentIdeaSchema>;
