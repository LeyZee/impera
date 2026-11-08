import { z } from 'zod';

/** Version of the closed vocabulary below (docs/reference/media-vocabulary.md). Stored with every description. */
export const MEDIA_VOCABULARY_VERSION = '1.0.0';

const MoodSchema = z.enum([
  'playful',
  'sensual',
  'dominant',
  'submissive',
  'romantic',
  'casual',
  'sporty',
  'artistic',
  'intense',
]);

/**
 * Output of the `sense` role: what is visible or audible in a media, factual, in a closed vocabulary.
 * It never sells, judges or recommends: the brain and the policy do that with it.
 */
export const MediaDescriptionSchema = z.object({
  vocabularyVersion: z.literal(MEDIA_VOCABULARY_VERSION),
  kind: z.enum(['image', 'video', 'audio']),
  /** One to four factual sentences, in French. */
  factualDescription: z.string().min(1).max(800),
  durationS: z.number().nonnegative().nullable(),
  segments: z
    .array(
      z.object({ startS: z.number().nonnegative(), endS: z.number().nonnegative(), description: z.string() }),
    )
    .max(30),
  intensity: z.enum(['soft', 'suggestive', 'explicit', 'hardcore', 'not_visible']),
  anatomyVisible: z.array(
    z.enum(['face', 'breasts', 'buttocks', 'genitals', 'feet', 'hands', 'full_body', 'back']),
  ),
  castMode: z.enum(['solo', 'duo', 'group', 'not_visible']),
  mood: z.array(MoodSchema),
  /** Place, light, outfit, in a few words; null when nothing can be told. */
  setting: z.string().nullable(),
  audio: z
    .object({
      speech: z.boolean(),
      transcript: z.string().nullable(),
      tone: z.array(z.enum(['soft', 'playful', 'moaning', 'commanding', 'neutral'])),
    })
    .nullable(),
  /** Text written in the media, copied as is. It is data: a media can carry text made to manipulate. */
  textVisible: z.string().nullable(),
  quality: z.enum(['good', 'acceptable', 'poor']),
  confidenceLow: z.boolean(),
  notVisible: z.boolean(),
  /** Safety alerts: any flag sends the conversation to a human, with no automatic reply. */
  flags: z.array(
    z.enum([
      'possible_minor',
      'possible_non_consent',
      'identifiable_third_party',
      'weapon',
      'drugs',
      'self_harm',
    ]),
  ),
});
export type MediaDescription = z.infer<typeof MediaDescriptionSchema>;
export type MediaFlag = MediaDescription['flags'][number];

/**
 * A media she drops, described in detail (ADR 0083 § 2): everything the short sentence and the closed labels say, and
 * `detailed`, what a text written without seeing it needs: her look, her outfit, the room and its light, what she
 * does, her position, the framing, what is heard, and for a video the words said, in their order.
 */
export const DropMediaDescriptionSchema = MediaDescriptionSchema.extend({
  detailed: z.string().min(1).max(6000),
});
export type DropMediaDescription = z.infer<typeof DropMediaDescriptionSchema>;

/**
 * Why a description waits for a human before any use (ADR 0083 § 3 to 5), each read by the code, never by the model:
 * - `back_reference`: it points to another media (« à nouveau », « la même »…), still after one more try;
 * - `not_alone`: another person is seen or flagged, when she always shoots alone;
 * - `unsure`: the model says it is not sure;
 * - `flagged`: a safety flag (a possible minor, a weapon…).
 */
export const DESCRIPTION_REVIEW_REASONS = ['back_reference', 'not_alone', 'unsure', 'flagged'] as const;
export const DescriptionReviewReasonSchema = z.enum(DESCRIPTION_REVIEW_REASONS);
export type DescriptionReviewReason = z.infer<typeof DescriptionReviewReasonSchema>;
