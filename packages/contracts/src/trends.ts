import { z } from 'zod';

import { DropCategorySchema } from './content-drops';
import { AgencySuggestionSchema, CreatorTaskTitleSchema } from './creator-tasks';
import {
  ContentIdeaIdSchema,
  CreatorIdSchema,
  ExtensionLinkIdSchema,
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
  /** Her agenda's title (80 at most): a validated idea becomes a suggestion under it, never cut. */
  title: CreatorTaskTitleSchema,
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

/** What `POST /v1/trends/links` answers: the signal, and whether this paste added it (a second paste adds nothing). */
export const PastedTrendLinkSchema = z.strictObject({
  created: z.boolean(),
  url: z.string().max(2048),
  expiresAt: z.iso.datetime().nullable(),
});
export type PastedTrendLink = z.infer<typeof PastedTrendLinkSchema>;

/**
 * The link of one browser's extension to the server (VEI-01 lot b), 256 random bits in base64url: shown once at its
 * creation, kept as a hash only, sent by the extension in `x-extension-link` with each batch of readings.
 */
export const ExtensionLinkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);

/** A person links one extension per browser, this many at most at once (Chrome and Edge, a laptop). */
export const EXTENSION_LINKS_LIVE_MAX = 3;

/** The browser a link was made for, as the person names it (« Chrome », « Edge du bureau »). */
export const ExtensionLinkLabelSchema = z.string().trim().min(1).max(40);

/** One live link, never its token. `lastUsedAt`: the last batch it brought, null before the first. */
export const ExtensionLinkSchema = z.strictObject({
  id: ExtensionLinkIdSchema,
  label: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type ExtensionLink = z.infer<typeof ExtensionLinkSchema>;

/** `GET /v1/trends/extension-links`: the person's live links, the oldest first. */
export const ExtensionLinkListSchema = z.strictObject({ items: z.array(ExtensionLinkSchema) });
export type ExtensionLinkList = z.infer<typeof ExtensionLinkListSchema>;

/**
 * `POST /v1/trends/extension-links` (« Relier l'extension »): a live link of the same label is replaced (the same
 * browser linked again), otherwise one is added; past `EXTENSION_LINKS_LIVE_MAX`, 409 `extension_links_full_conflict`.
 */
export const CreateExtensionLinkBodySchema = z.strictObject({ label: ExtensionLinkLabelSchema });
export type CreateExtensionLinkBody = z.infer<typeof CreateExtensionLinkBodySchema>;

/** Its answer: the new token, once. */
export const ExtensionLinkCreatedSchema = ExtensionLinkSchema.omit({ lastUsedAt: true }).extend({
  token: ExtensionLinkTokenSchema,
});
export type ExtensionLinkCreated = z.infer<typeof ExtensionLinkCreatedSchema>;

/**
 * `GET /v1/trends/readings/creators`, with `x-extension-link`: the creators the linked person may mark a post for,
 * as `POST /v1/trends/readings` checks them (herself for a creator; every creator for the agency).
 */
export const ExtensionLinkCreatorsSchema = z.strictObject({
  items: z.array(z.strictObject({ id: CreatorIdSchema, displayName: z.string() })),
});
export type ExtensionLinkCreators = z.infer<typeof ExtensionLinkCreatorsSchema>;

/** `POST /v1/trends/readings`: how many posts of the batch were kept, new or seen again. */
export const TrendReadingsAcceptedSchema = z.strictObject({ accepted: z.number().int().min(0) });
export type TrendReadingsAccepted = z.infer<typeof TrendReadingsAcceptedSchema>;

/* ---- The captures of a marked post (ADR 0060 § 2, source 6; VEI-01 lot c2) ---- */

/** At most four captures of the visible tab, taken while the marked post shows. */
export const TREND_CAPTURES_MAX = 4;
/** One capture, decoded: a JPEG of a full-HD tab at the extension's quality stays well under it. */
export const TREND_CAPTURE_MAX_BYTES = 750_000;
/** Its base64, padding included. */
const TREND_CAPTURE_MAX_BASE64 = Math.ceil(TREND_CAPTURE_MAX_BYTES / 3) * 4;

export const TrendCaptureSchema = z.strictObject({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  data: z.base64().max(TREND_CAPTURE_MAX_BASE64),
});
export type TrendCapture = z.infer<typeof TrendCaptureSchema>;

/**
 * `POST /v1/trends/readings/captures`, with `x-extension-link`: the captures of one post the person marked in this watch
 * session, its reading already sent. Held in memory for the vision call only, then dropped: never written, never logged,
 * never echoed. Only the description stays, on the reading.
 */
export const TrendCapturesBodySchema = z.strictObject({
  watchSession: WatchSessionIdSchema,
  code: InstagramPostCodeSchema,
  /** The length of the video as its element shows it; null for a photo or a carousel. */
  durationS: z.number().positive().max(3_600).nullable(),
  captures: z.array(TrendCaptureSchema).min(1).max(TREND_CAPTURES_MAX),
});
export type TrendCapturesBody = z.infer<typeof TrendCapturesBodySchema>;

/** What the vision model says of a post from its captures: how it is made, never the post itself. */
export const TrendCaptureDescriptionSchema = z.strictObject({
  /** What holds the eye in the first seconds, in a sentence. */
  hook: z.string().min(1).max(300),
  /** The angles and shots, a few words each. */
  angles: z.array(z.string().min(1).max(120)).max(6),
  /** The text written on the screen, copied as it shows; null when there is none. */
  onScreenText: z.string().min(1).max(500).nullable(),
  /** The cutting and its pace, as far as the captures let it be judged. */
  editing: z.string().min(1).max(300),
});
export type TrendCaptureDescription = z.infer<typeof TrendCaptureDescriptionSchema>;

/** Its answer: the description kept on the reading. */
export const TrendCapturesDescribedSchema = z.strictObject({ description: TrendCaptureDescriptionSchema });
export type TrendCapturesDescribed = z.infer<typeof TrendCapturesDescribedSchema>;

/** No reading of that post in that session marked for a creator: send the reading, marked, first. */
export const TREND_CAPTURE_READING_NOT_FOUND = 'trend_capture_reading_not_found';
/** The trend watch's cap of the day is spent (ADR 0060 § 7): no vision until midnight, shown in amber. */
export const TREND_WATCH_BUDGET_LIMITED = 'trend_watch_budget_limited';
/** No vision model answered (no key, every model failed): the captures are dropped, the reading stays. */
export const TREND_CAPTURE_VISION_UNAVAILABLE = 'trend_capture_vision_unavailable';

/* ------------------------------------------------------------------------------------------------------------------
 * VEI-01 lot d: « Idées du jour » (ADR 0060 § 5), for the owner and an active manager. Validated, corrected on the spot
 * or refused; a validated idea becomes a suggestion in her agenda, its « à tourner » her shooting sheet.
 * ---------------------------------------------------------------------------------------------------------------- */

/**
 * `GET /v1/creators/:creatorId/ideas?day=` (owner, active manager): the ideas proposed on one of her days, today in her
 * zone when `day` is left out. Each with the signal it cites, which the agency reads and she never does.
 */
export const ContentIdeasQuerySchema = z.strictObject({ day: CalendarDaySchema.optional() });
export const ContentIdeaOfDaySchema = ContentIdeaSchema.extend({ signal: TrendSignalSchema });
export type ContentIdeaOfDay = z.infer<typeof ContentIdeaOfDaySchema>;
export const ContentIdeaListSchema = z.strictObject({
  /** The day read, in her zone. */
  day: CalendarDaySchema,
  items: z.array(ContentIdeaOfDaySchema),
});
export type ContentIdeaList = z.infer<typeof ContentIdeaListSchema>;

/** What the agency may correct of an idea before validating it: never its origin signal. */
export const ContentIdeaCorrectionSchema = ContentIdeaDraftSchema.omit({ signalId: true })
  .partial()
  .refine((correction) => Object.keys(correction).length > 0, { message: 'Rien à corriger' });
export type ContentIdeaCorrection = z.infer<typeof ContentIdeaCorrectionSchema>;

/**
 * `POST /v1/creators/:creatorId/ideas/:ideaId/validate` (owner, active manager): as it is, or corrected. The code reads
 * the idea as it leaves again (her limits, « jamais de nu » for a public output, the Instagram guard): a correction that
 * breaks one is refused (422), never sent. Replayed, the same gesture changes nothing and its correction is not read.
 */
export const ValidateContentIdeaBodySchema = z.strictObject({
  correction: ContentIdeaCorrectionSchema.nullable().default(null),
});
export type ValidateContentIdeaBody = z.infer<typeof ValidateContentIdeaBodySchema>;

/** The answer of a validation: the idea, and the suggestion it became (undated when no dispo of hers had room). */
export const ValidatedContentIdeaSchema = z.strictObject({
  idea: ContentIdeaSchema,
  suggestion: AgencySuggestionSchema,
});
export type ValidatedContentIdea = z.infer<typeof ValidatedContentIdeaSchema>;

/** `POST /v1/creators/:creatorId/ideas/:ideaId/refuse` (owner, active manager): a reason if one is given. Never proposed again. */
export const RefuseContentIdeaBodySchema = z.strictObject({
  reason: z.string().trim().min(1).max(280).nullable().default(null),
});
export type RefuseContentIdeaBody = z.infer<typeof RefuseContentIdeaBodySchema>;

/** Refusals of « Idées du jour », beside the shared ones. */
export const CONTENT_IDEA_NOT_FOUND = 'content_idea_not_found';
export const CONTENT_IDEA_FORBIDDEN = 'content_idea_forbidden';
/** Validated when refused, or refused once validated: the other gesture is refused. */
export const CONTENT_IDEA_DECIDED_CONFLICT = 'content_idea_decided_conflict';
/** The idea, as corrected, touches one of her limits or breaks a guard of its output: corrected again, or refused. */
export const CONTENT_IDEA_GUARD_UNPROCESSABLE = 'content_idea_guard_unprocessable';
