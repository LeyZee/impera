import { z } from 'zod';

import {
  CUSTOM_MINUTES_MAX,
  CUSTOM_SUPPLEMENTS_MAX,
  CustomFormatSchema,
  CustomSupplementIdSchema,
  type CustomFormat,
} from './custom-prices';

/**
 * A custom order as the code follows it (ADR 0159 § A): what the brain reads of his request, the details the code
 * still needs, and the order's state. The brain fills boxes from closed lists; the code says what is missing, when the
 * card goes to her, and never lets a price out before her yes. His words are data: a detail's value never enters a
 * brief, only a typed untrusted block of the prompt.
 */

/** The details a card can hold (ADR 0159 § A.2). Which ones a format needs is the code's (`ESSENTIAL_DETAILS`). */
export const CUSTOM_DETAIL_KEYS = [
  /** What he wants to see, said precisely. */
  'what',
  /** For when he would like it. */
  'when',
  /** A first name or a word to say or write, if any. */
  'name_to_say',
  'pose',
  'outfit',
  /** The text written on her, for a photo. */
  'written_text',
  'photo_count',
  /** How long: a video, a call, a video call. */
  'duration',
  /** How a video unfolds. */
  'scenario',
  /** What she says in a video. */
  'words',
  /** The photo he sends for a reaction or a rating: already received. */
  'photo_received',
  /** The tone he wants for a reaction or a rating. */
  'tone',
  /** When he is free, for a call or a video call. */
  'availability',
] as const;
export const CustomDetailKeySchema = z.enum(CUSTOM_DETAIL_KEYS);
export type CustomDetailKey = z.infer<typeof CustomDetailKeySchema>;

/** A detail is a few words of his, never a page. */
export const CUSTOM_DETAIL_MAX = 120;

const DetailValueSchema = z.string().trim().min(1).max(CUSTOM_DETAIL_MAX);
export const CustomDetailsSchema = z.partialRecord(CustomDetailKeySchema, DetailValueSchema);
export type CustomDetails = z.infer<typeof CustomDetailsSchema>;

/**
 * What the brain reads of his custom request on this turn: the format, the supplements of her grid (ids from the list
 * given on the turn, never a price), the minutes when they count, and the details he gave.
 */
export const CustomOrderReadingSchema = z
  .object({
    format: CustomFormatSchema.nullable(),
    supplements: z.array(CustomSupplementIdSchema).max(CUSTOM_SUPPLEMENTS_MAX),
    minutes: z.number().int().min(1).max(CUSTOM_MINUTES_MAX).nullable(),
    details: CustomDetailsSchema,
  })
  .strict();
export type CustomOrderReading = z.infer<typeof CustomOrderReadingSchema>;

/**
 * The same reading as a model writes it: every field may be null or missing, a detail may run long. Normalised into
 * the strict reading: nothing missing becomes a guess, an unknown supplement or detail key is dropped, a long detail is
 * cut. Parsing never fails on a field the model left out.
 */
export const CustomOrderReadingFromModelSchema = z
  .object({
    format: z.string().nullish(),
    supplements: z.array(z.string()).nullish(),
    minutes: z.number().nullish(),
    details: z.record(z.string(), z.string().nullish()).nullish(),
  })
  .transform((raw): CustomOrderReading => {
    const format = CustomFormatSchema.safeParse(raw.format);
    const supplements = [
      ...new Set((raw.supplements ?? []).filter((id) => CustomSupplementIdSchema.safeParse(id).success)),
    ].slice(0, CUSTOM_SUPPLEMENTS_MAX);
    const minutes =
      typeof raw.minutes === 'number' && Number.isInteger(raw.minutes)
        ? Math.min(Math.max(raw.minutes, 1), CUSTOM_MINUTES_MAX)
        : null;
    const details: CustomDetails = {};
    for (const [key, value] of Object.entries(raw.details ?? {})) {
      const known = CustomDetailKeySchema.safeParse(key);
      const text = (value ?? '').trim().slice(0, CUSTOM_DETAIL_MAX).trim();
      if (known.success && text !== '') details[known.data] = text;
    }
    return { format: format.success ? format.data : null, supplements, minutes, details };
  });

/** Only the supplements offered to the brain on this turn: any other id is dropped, as a script pick is. */
export function supplementsIn(reading: CustomOrderReading, allowed: readonly string[]): CustomOrderReading {
  return { ...reading, supplements: reading.supplements.filter((id) => allowed.includes(id)) };
}

/**
 * The details a card needs before it goes to her, per format (ADR 0159 § A.2): two or three, never a questionnaire.
 * The others are kept when he gives them and shown on the card, never asked.
 */
export const ESSENTIAL_DETAILS: Readonly<Record<CustomFormat, readonly CustomDetailKey[]>> = {
  photo: ['what', 'when'],
  video: ['what', 'duration', 'when'],
  reaction_video: ['photo_received', 'tone'],
  rating: ['photo_received', 'tone'],
  call: ['duration', 'availability'],
  video_call_talk: ['duration', 'availability'],
  video_call_sexual: ['duration', 'availability'],
};

/** At most this many questions about his order; past them the card goes to the owner as it is (ADR 0159 § A.2 bis). */
export const CUSTOM_ORDER_QUESTIONS_MAX = 3;

/** The states of an order (ADR 0159 § A.1). `gathering` comes first: the details are not all there yet. */
export const CUSTOM_ORDER_STATES = [
  'gathering',
  'awaiting_creator',
  'creator_yes',
  'creator_no',
  'deposit_paid',
  'delivered',
  'expired',
  'cancelled',
] as const;
export const CustomOrderStateSchema = z.enum(CUSTOM_ORDER_STATES);
export type CustomOrderState = z.infer<typeof CustomOrderStateSchema>;

/** His order as it stands: what has been read so far, and how many questions she already asked about it. */
export const OpenCustomOrderSchema = z
  .object({
    state: CustomOrderStateSchema,
    format: CustomFormatSchema.nullable(),
    supplements: z.array(CustomSupplementIdSchema).max(CUSTOM_SUPPLEMENTS_MAX),
    minutes: z.number().int().min(1).max(CUSTOM_MINUTES_MAX).nullable(),
    details: CustomDetailsSchema,
    questionsAsked: z.number().int().min(0),
  })
  .strict();
export type OpenCustomOrder = z.infer<typeof OpenCustomOrderSchema>;
