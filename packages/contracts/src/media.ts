import { z } from 'zod';

/**
 * Version of the closed vocabulary below (docs/reference/media-vocabulary.md), written with every new description.
 * 1.1.0 adds the outfit of a media she drops (ADR 0083 § 2, amendment of 20/11/2026); a description of 1.0.0 stays
 * valid as it is, never described again for it.
 */
export const MEDIA_VOCABULARY_VERSION = '1.1.0';
export const MEDIA_VOCABULARY_VERSIONS = ['1.0.0', MEDIA_VOCABULARY_VERSION] as const;

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
  vocabularyVersion: z.enum(MEDIA_VOCABULARY_VERSIONS),
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
/**
 * What she wears at the start of a media (ADR 0083 § 2, amendment of 20/11/2026), in a closed vocabulary: the style
 * that tells lingerie from the rest, then each piece seen with its colours. Read by the code (her catalogue, the gifts
 * matched to a fan's tastes) where the prose of `detailed` cannot be.
 */
export const OUTFIT_STYLES = [
  'lingerie',
  'nightwear',
  'evening',
  'casual',
  'sportswear',
  'swimwear',
  'costume',
  'nothing',
  'other',
] as const;
export const OutfitStyleSchema = z.enum(OUTFIT_STYLES);
export type OutfitStyle = z.infer<typeof OutfitStyleSchema>;

export const OUTFIT_PIECES = [
  'lingerie_top',
  'lingerie_bottom',
  'bodysuit',
  'garter_belt',
  'stockings',
  'dress',
  'skirt',
  'top',
  'shirt',
  'sweater',
  'jacket',
  'trousers',
  'shorts',
  'swimsuit',
  'robe',
  'pyjamas',
  'towel',
  'heels',
  'shoes',
  'boots',
  'accessory',
  'other',
] as const;
export const OutfitPieceTypeSchema = z.enum(OUTFIT_PIECES);
export type OutfitPieceType = z.infer<typeof OutfitPieceTypeSchema>;

export const OUTFIT_COLOURS = [
  'black',
  'white',
  'red',
  'pink',
  'purple',
  'blue',
  'green',
  'yellow',
  'orange',
  'brown',
  'beige',
  'grey',
  'gold',
  'silver',
  'nude',
  'transparent',
  'multicolour',
] as const;
export const OutfitColourSchema = z.enum(OUTFIT_COLOURS);
export type OutfitColour = z.infer<typeof OutfitColourSchema>;

export const OutfitSchema = z.object({
  /** The outfit as a whole; `nothing` when she wears nothing from the start. */
  style: OutfitStyleSchema,
  /** Each piece seen at the start, its main colours first; empty with `nothing`. */
  pieces: z
    .array(z.object({ type: OutfitPieceTypeSchema, colours: z.array(OutfitColourSchema).min(1).max(3) }))
    .max(10),
});
export type Outfit = z.infer<typeof OutfitSchema>;

export const DropMediaDescriptionSchema = MediaDescriptionSchema.extend({
  detailed: z.string().min(1).max(6000),
  /**
   * Her outfit at the start of the media (the first frames of a video); `null` when it cannot be seen (a voice note,
   * nothing visible). Absent from a description of vocabulary 1.0.0, read as not known.
   */
  outfit: OutfitSchema.nullable().optional(),
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
