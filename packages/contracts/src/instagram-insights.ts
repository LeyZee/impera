import { z } from 'zod';

import { InstagramMediaKindSchema, InstagramMediaRefSchema } from './instagram-comments';

/**
 * What is read of her own Instagram account (ADR 0120 § 1 and § 2): her media, their numbers kept by age, and her
 * stories online. Numbers only: never the text nor the name of a commenter, never a private message.
 */

/** The rights asked of Meta to read (ADR 0120 § 1): a closed list in the code, asked first and alone. */
export const META_READ_SCOPES = ['instagram_business_basic', 'instagram_business_manage_insights'] as const;

/** The right to publish, asked later by a second consent (ADR 0120 § 1, ADR 0057 § 2). */
export const META_PUBLISH_SCOPES = ['instagram_business_content_publish'] as const;

/** What a connected account can do: it follows from the rights Meta really granted, never from a setting. */
export const InstagramAccountCapabilitiesSchema = z.strictObject({
  read: z.boolean(),
  publish: z.boolean(),
});
export type InstagramAccountCapabilities = z.infer<typeof InstagramAccountCapabilitiesSchema>;

/** The longest caption Instagram lets a media carry. */
export const INSTAGRAM_CAPTION_MAX = 2200;

/** One of her media as the connector lists it. Its caption is hers, and still untrusted text once in a prompt. */
export const InstagramMediaSchema = z.strictObject({
  ref: InstagramMediaRefSchema,
  kind: InstagramMediaKindSchema,
  caption: z.string().max(INSTAGRAM_CAPTION_MAX).nullable(),
  publishedAt: z.iso.datetime(),
});
export type InstagramMedia = z.infer<typeof InstagramMediaSchema>;

const count = z.number().int().nonnegative();

/**
 * The numbers Meta gives of a media. A number Meta does not give for this kind of media is null, never a zero made
 * up: the skip rate exists for a Reel only.
 */
export const MediaInsightNumbersSchema = z.strictObject({
  views: count,
  reach: count,
  likes: count,
  comments: count,
  shares: count,
  saves: count,
  reposts: count.nullable(),
  /** The part of the viewers of a Reel who skipped it at once, 0 to 1. */
  skipRate: z.number().min(0).max(1).nullable(),
});
export type MediaInsightNumbers = z.infer<typeof MediaInsightNumbersSchema>;

/** The ages a reading is kept at (ADR 0120 § 2). */
export const SNAPSHOT_AGES = ['1h', '24h', '48h', '7d'] as const;
export const SnapshotAgeSchema = z.enum(SNAPSHOT_AGES);
export type SnapshotAge = z.infer<typeof SnapshotAgeSchema>;

/**
 * A reading kept (`media_insight_snapshot`): one per media and per age. The age is a step: the first reading made
 * after it, with the real instant of the reading beside.
 */
export const MediaInsightSnapshotSchema = z.strictObject({
  mediaRef: InstagramMediaRefSchema,
  age: SnapshotAgeSchema,
  readAt: z.iso.datetime(),
  numbers: MediaInsightNumbersSchema,
});
export type MediaInsightSnapshot = z.infer<typeof MediaInsightSnapshotSchema>;

/** How Instagram names a story: opaque to us. */
export const InstagramStoryRefSchema = z.string().min(1).max(128).brand<'InstagramStoryRef'>();
export type InstagramStoryRef = z.infer<typeof InstagramStoryRefSchema>;

/** A story of hers that is online: its name, its hour and its numbers, to know whether the day has its story. */
export const LiveStorySchema = z.strictObject({
  ref: InstagramStoryRefSchema,
  publishedAt: z.iso.datetime(),
  views: count,
  reach: count,
});
export type LiveStory = z.infer<typeof LiveStorySchema>;
