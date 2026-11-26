import { z } from 'zod';

import {
  CUSTOM_MINUTES_MAX,
  CUSTOM_PRICE_MAX_MINOR,
  CUSTOM_SUPPLEMENTS_MAX,
  CustomFormatSchema,
  CustomSupplementIdSchema,
  isPerMinute,
  type CustomFormat,
} from './custom-prices';
import { ConversationIdSchema, CustomOrderIdSchema, FanIdSchema } from './ids';

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

/** The grid's price on the card, as stored: the sum, her refusal given in advance, or « hors grille ». */
export const StoredCustomQuoteSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('price'),
    totalMinor: z.number().int().min(0),
    lines: z.array(z.looseObject({ kind: z.string(), amountMinor: z.number().int() })),
  }),
  z.object({ kind: z.literal('declined'), by: z.string() }),
  z.object({ kind: z.literal('off_grid'), missing: z.array(z.string()) }),
]);

/** The card for her (ADR 0159 § A.2 bis), as the turn kept it: what he asked, and the price her grid proposes. */
export const CustomOrderCardSchema = z.object({
  format: CustomFormatSchema.nullable(),
  supplements: z.array(z.string()),
  minutes: z.number().int().nullable(),
  details: CustomDetailsSchema,
  quote: StoredCustomQuoteSchema.nullable(),
  to: z.enum(['creator', 'owner']),
  missing: z.array(z.string()),
});
export type CustomOrderCardView = z.infer<typeof CustomOrderCardSchema>;

/**
 * What he pays before she starts (ADR 0159 § A.4, Charles 20/11): half of a video as a tip, a call or a video call in
 * full; anything else is paid when it is delivered (null). Pure: the screen and the server read the same sum.
 */
export function customDepositMinor(format: CustomFormat | null, priceMinor: number): number | null {
  if (format === 'video') return Math.round(priceMinor / 200) * 100;
  if (format !== null && isPerMinute(format)) return priceMinor;
  return null;
}

/** A cam's slot, as instants. */
export const CustomOrderCamSchema = z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() });
export type CustomOrderCam = z.infer<typeof CustomOrderCamSchema>;

/** His order as the agency reads it: the card, her answer and price, and where it stands up to delivery. */
export const CustomOrderViewSchema = z.object({
  id: CustomOrderIdSchema,
  fanId: FanIdSchema,
  fanName: z.string(),
  conversationId: ConversationIdSchema.nullable(),
  state: CustomOrderStateSchema,
  format: CustomFormatSchema.nullable(),
  supplements: z.array(z.string()),
  minutes: z.number().int().nullable(),
  details: CustomDetailsSchema,
  card: CustomOrderCardSchema.nullable(),
  /** Her price, set with her yes; null before. Never shown to the fan before that. */
  priceMinor: z.number().int().nullable(),
  depositMinor: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  /**
   * A call's or a video call's slot, booked by the code in her dispos cam once he paid it all (ADR 0159 § 5); null
   * before, for anything else, or when none of her dispos cam had room (the hour is then set with her).
   */
  cam: CustomOrderCamSchema.nullable().default(null),
});
export type CustomOrderView = z.infer<typeof CustomOrderViewSchema>;

export const CustomOrderListSchema = z.object({ orders: z.array(CustomOrderViewSchema) });
export type CustomOrderList = z.infer<typeof CustomOrderListSchema>;

/** Which orders a list shows: those still moving (before delivery), or every one. */
export const CustomOrderListQuerySchema = z.object({ scope: z.enum(['active', 'all']).default('active') });

/** Her answer, entered by the owner (ADR 0159 § A.3): yes at a price, or no. */
export const DecideCustomOrderBodySchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('yes'), priceMinor: z.number().int().min(100).max(CUSTOM_PRICE_MAX_MINOR) }),
  z.object({ decision: z.literal('no') }),
]);
export type DecideCustomOrderBody = z.infer<typeof DecideCustomOrderBodySchema>;

/** The next step of an order she said yes to: deposit received, delivered, or cancelled. */
export const AdvanceCustomOrderBodySchema = z.object({
  to: z.enum(['deposit_paid', 'delivered', 'cancelled']),
});
export type AdvanceCustomOrderBody = z.infer<typeof AdvanceCustomOrderBodySchema>;

/** The states an order may move to from each state, by a person (the turn moves `gathering` and `awaiting_creator`). */
export const CUSTOM_ORDER_MOVES: Readonly<Record<CustomOrderState, readonly CustomOrderState[]>> = {
  gathering: ['creator_yes', 'creator_no', 'cancelled'],
  awaiting_creator: ['creator_yes', 'creator_no', 'cancelled'],
  creator_yes: ['deposit_paid', 'delivered', 'cancelled'],
  creator_no: [],
  deposit_paid: ['delivered', 'cancelled'],
  delivered: [],
  expired: [],
  cancelled: [],
};

/** The states still moving: shown in « Commandes en cours ». */
export const ACTIVE_CUSTOM_ORDER_STATES: readonly CustomOrderState[] = [
  'gathering',
  'awaiting_creator',
  'creator_yes',
  'deposit_paid',
];

export const CUSTOM_ORDER_ERROR_CODES = ['custom_order_not_found', 'custom_order_move_conflict'] as const;
export type CustomOrderErrorCode = (typeof CUSTOM_ORDER_ERROR_CODES)[number];
