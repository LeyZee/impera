import { z } from 'zod';

import { CreatorIdSchema } from './ids';

/**
 * Her grid of custom prices (ADR 0159 § C): what a fan's custom order costs, before she says yes. A price per format,
 * then supplements in percent that add up whatever the format. The owner fills it in himself, supplements' names
 * included: the repository only knows its shape, never a price (ADR 0010) nor what a supplement names (public
 * repository). The code computes a price from it (`quoteCustomOrder`), never a model.
 */

/** What he orders (ADR 0159 § 0), in the order the screen lists them. */
export const CUSTOM_FORMATS = [
  'photo',
  'video',
  'reaction_video',
  'rating',
  'call',
  'video_call_talk',
  'video_call_sexual',
] as const;
export const CustomFormatSchema = z.enum(CUSTOM_FORMATS);
export type CustomFormat = z.infer<typeof CustomFormatSchema>;

/** The formats priced by the minute, with a minimum (a call, a video call): paid in full first (ADR 0159 § D). */
export const PER_MINUTE_FORMATS: readonly CustomFormat[] = ['call', 'video_call_talk', 'video_call_sexual'];
export const isPerMinute = (format: CustomFormat): boolean => PER_MINUTE_FORMATS.includes(format);

/** Highest price of a line, in minor units (10 000 €): above it, a typing slip rather than a price. */
export const CUSTOM_PRICE_MAX_MINOR = 1_000_000;
/** Highest supplement, in percent of the format's price. */
export const CUSTOM_PERCENT_MAX = 1000;
/** Longest call or video call bought at once, and the longest video, in minutes. */
export const CUSTOM_MINUTES_MAX = 240;
/** At most this many supplements. */
export const CUSTOM_SUPPLEMENTS_MAX = 40;
export const CUSTOM_SUPPLEMENT_LABEL_MAX = 40;
/** At most this many lines of videos already shot. */
export const READY_VIDEOS_MAX = 40;
export const READY_VIDEO_LABEL_MAX = 40;
/** Lowest bound of a ready video's range, in minor units (1 €). */
export const READY_VIDEO_MIN_MINOR = 100;

const PriceMinorSchema = z.number().int().min(0).max(CUSTOM_PRICE_MAX_MINOR);
const PercentSchema = z.number().int().min(0).max(CUSTOM_PERCENT_MAX);
const MinutesSchema = z.number().int().min(1).max(CUSTOM_MINUTES_MAX);

/**
 * One format of her grid. `priceMinor` is a fixed price, or the price of one minute for a call or a video call; null,
 * not filled in yet. `minMinutes` only for a call or a video call; `includedMinutes` and `extraMinutePercent` only
 * for a video (a longer video costs that percent of its price per minute over).
 */
export const CustomFormatLineSchema = z
  .object({
    format: CustomFormatSchema,
    offered: z.boolean(),
    priceMinor: PriceMinorSchema.nullable(),
    minMinutes: MinutesSchema.nullable(),
    includedMinutes: MinutesSchema.nullable(),
    extraMinutePercent: PercentSchema.nullable(),
  })
  .strict()
  .refine((line) => isPerMinute(line.format) || line.minMinutes === null, {
    message: 'Un minimum de minutes ne vaut que pour un appel ou une visio',
    path: ['minMinutes'],
  })
  .refine(
    (line) => line.format === 'video' || (line.includedMinutes === null && line.extraMinutePercent === null),
    {
      message: 'Les minutes comprises ne valent que pour une vidéo',
      path: ['includedMinutes'],
    },
  );
export type CustomFormatLine = z.infer<typeof CustomFormatLineSchema>;

/** A supplement's id: `sup_` and eight lowercase hex digits, drawn once by the screen and never reused. */
export const CustomSupplementIdSchema = z.string().regex(/^sup_[0-9a-f]{8}$/u);
export type CustomSupplementId = z.infer<typeof CustomSupplementIdSchema>;

/**
 * One supplement: a name the owner typed, a percent of the format's price, added whatever the format. `offered` false:
 * she never does it, the order is declined without asking her.
 */
export const CustomSupplementLineSchema = z
  .object({
    id: CustomSupplementIdSchema,
    label: z.string().trim().min(1).max(CUSTOM_SUPPLEMENT_LABEL_MAX),
    offered: z.boolean(),
    percent: PercentSchema.nullable(),
  })
  .strict();
export type CustomSupplementLine = z.infer<typeof CustomSupplementLineSchema>;

/** A ready video line's id: `rv_` and eight lowercase hex digits, drawn once by the screen and never reused. */
export const ReadyVideoIdSchema = z.string().regex(/^rv_[0-9a-f]{8}$/u);
export type ReadyVideoId = z.infer<typeof ReadyVideoIdSchema>;

/**
 * One kind of video she has already shot and sells outside scripts: a name the owner typed (the repository never
 * names one), and the range its price is drawn in. `offered` false: none of this kind is sold, whatever is in stock.
 */
export const ReadyVideoLineSchema = z
  .object({
    id: ReadyVideoIdSchema,
    label: z.string().trim().min(1).max(READY_VIDEO_LABEL_MAX),
    offered: z.boolean(),
    minMinor: z.number().int().min(READY_VIDEO_MIN_MINOR).max(CUSTOM_PRICE_MAX_MINOR),
    maxMinor: z.number().int().min(READY_VIDEO_MIN_MINOR).max(CUSTOM_PRICE_MAX_MINOR),
  })
  .strict()
  .refine((line) => line.maxMinor >= line.minMinor, {
    message: 'Le haut de la fourchette passe sous le bas',
    path: ['maxMinor'],
  });
export type ReadyVideoLine = z.infer<typeof ReadyVideoLineSchema>;

/**
 * Her whole grid: every format once, in `CUSTOM_FORMATS` order; then the supplements the owner added, in his order;
 * then the videos already shot, in his order. A grid saved before that list existed reads with none.
 */
export const CustomPriceGridSchema = z
  .object({
    formats: z.array(CustomFormatLineSchema).length(CUSTOM_FORMATS.length),
    supplements: z.array(CustomSupplementLineSchema).max(CUSTOM_SUPPLEMENTS_MAX),
    readyVideos: z.array(ReadyVideoLineSchema).max(READY_VIDEOS_MAX).default([]),
  })
  .strict()
  .refine((grid) => grid.formats.every((line, index) => line.format === CUSTOM_FORMATS[index]), {
    message: 'Chaque format une fois, dans l’ordre',
    path: ['formats'],
  })
  .refine((grid) => new Set(grid.supplements.map((line) => line.id)).size === grid.supplements.length, {
    message: 'Deux suppléments portent le même identifiant',
    path: ['supplements'],
  })
  .refine(
    (grid) =>
      new Set(grid.supplements.map((line) => line.label.toLowerCase())).size === grid.supplements.length,
    { message: 'Deux suppléments portent le même nom', path: ['supplements'] },
  )
  .refine((grid) => new Set(grid.readyVideos.map((line) => line.id)).size === grid.readyVideos.length, {
    message: 'Deux vidéos portent le même identifiant',
    path: ['readyVideos'],
  })
  .refine(
    (grid) =>
      new Set(grid.readyVideos.map((line) => line.label.toLowerCase())).size === grid.readyVideos.length,
    { message: 'Deux vidéos portent le même nom', path: ['readyVideos'] },
  );
export type CustomPriceGrid = z.infer<typeof CustomPriceGridSchema>;

/** A grid never filled in: every format there, offered, with no price; no supplement yet. */
export function emptyCustomPriceGrid(): CustomPriceGrid {
  return {
    formats: CUSTOM_FORMATS.map((format) => ({
      format,
      offered: true,
      priceMinor: null,
      minMinutes: null,
      includedMinutes: null,
      extraMinutePercent: null,
    })),
    supplements: [],
    readyVideos: [],
  };
}

/**
 * `GET /v1/creators/:creatorId/custom-prices`: her grid as it is now. `version` 0 and `updatedAt` null: never saved,
 * the grid is the empty one.
 */
export const CustomPriceGridViewSchema = z.object({
  creatorId: CreatorIdSchema,
  version: z.number().int().min(0),
  grid: CustomPriceGridSchema,
  updatedAt: z.iso.datetime().nullable(),
});
export type CustomPriceGridView = z.infer<typeof CustomPriceGridViewSchema>;

/**
 * `PUT /v1/creators/:creatorId/custom-prices`: the whole grid, on the version the screen read. Another version saved
 * since: 409, nothing written. The same grid again on the version it made: the same answer, nothing written.
 */
export const SaveCustomPriceGridBodySchema = z.object({
  baseVersion: z.number().int().min(0),
  grid: CustomPriceGridSchema,
});
export type SaveCustomPriceGridBody = z.infer<typeof SaveCustomPriceGridBodySchema>;

export const CUSTOM_PRICE_ERROR_CODES = [
  /** No such creator, archived, or not the owner's to read. */
  'custom_prices_creator_not_found',
  /** Another version was saved since the one the screen read. */
  'custom_prices_version_conflict',
] as const;
export type CustomPriceErrorCode = (typeof CUSTOM_PRICE_ERROR_CODES)[number];

/** What a custom order asks, as the code reads it (ADR 0159 § 0): a format, supplements, minutes when they count. */
export interface CustomOrderAsk {
  readonly format: CustomFormat;
  readonly supplements: readonly CustomSupplementId[];
  /** Minutes asked: a call or a video call (at least its minimum), a video (over its included minutes). */
  readonly minutes?: number;
}

/** One line of the sum, as she reads it before saying yes: « vidéo 40 € », « +20 % ». */
export type CustomQuoteLine =
  | {
      readonly kind: 'format';
      readonly format: CustomFormat;
      readonly amountMinor: number;
      readonly minutes?: number;
    }
  | { readonly kind: 'extra_minutes'; readonly minutes: number; readonly amountMinor: number }
  | {
      readonly kind: 'supplement';
      readonly id: CustomSupplementId;
      readonly percent: number;
      readonly amountMinor: number;
    };

export type CustomQuote =
  /** The price the grid gives, rounded to the euro, and how it was made. */
  | { readonly kind: 'price'; readonly totalMinor: number; readonly lines: readonly CustomQuoteLine[] }
  /** She never does it: the order is declined without asking her (ADR 0159 § 0). */
  | { readonly kind: 'declined'; readonly by: string }
  /** A line has no price yet, or a supplement is unknown to the grid: it goes to her with no price (« hors grille »). */
  | { readonly kind: 'off_grid'; readonly missing: readonly string[] };

/** Rounded to the euro, half up: the price a fan reads is a round one. */
const toEuro = (minor: number): number => Math.round(minor / 100) * 100;

/**
 * The price her grid gives for an order (ADR 0159 § C, 15 bis): the format's price (by the minute times the minutes
 * for a call or a video call, at least its minimum; a video's minutes over its included ones add their percent),
 * then each supplement's percent of that, added up. Pure: the screen's calculator and the server read the same sum.
 */
export function quoteCustomOrder(grid: CustomPriceGrid, ask: CustomOrderAsk): CustomQuote {
  const formatLine = grid.formats.find((line) => line.format === ask.format);
  if (formatLine === undefined) return { kind: 'off_grid', missing: [ask.format] };
  if (!formatLine.offered) return { kind: 'declined', by: ask.format };
  const asked = [...new Set(ask.supplements)];
  const supplementLines = asked.map((id) => ({ id, line: grid.supplements.find((one) => one.id === id) }));
  const refused = supplementLines.find(({ line }) => line !== undefined && !line.offered);
  if (refused !== undefined) return { kind: 'declined', by: refused.id };
  const missing: string[] = [];
  if (formatLine.priceMinor === null) missing.push(ask.format);
  for (const { id, line } of supplementLines)
    if (line?.percent === null || line === undefined) missing.push(id);
  if (missing.length > 0 || formatLine.priceMinor === null) return { kind: 'off_grid', missing };

  const price = formatLine.priceMinor;
  const lines: CustomQuoteLine[] = [];
  let base: number;
  if (isPerMinute(ask.format)) {
    const minutes = Math.max(ask.minutes ?? formatLine.minMinutes ?? 1, formatLine.minMinutes ?? 1);
    base = price * minutes;
    lines.push({ kind: 'format', format: ask.format, amountMinor: base, minutes });
  } else {
    base = price;
    lines.push({ kind: 'format', format: ask.format, amountMinor: price });
    const over =
      ask.format === 'video' && ask.minutes !== undefined && formatLine.includedMinutes !== null
        ? Math.max(0, ask.minutes - formatLine.includedMinutes)
        : 0;
    if (over > 0 && formatLine.extraMinutePercent !== null && formatLine.extraMinutePercent > 0) {
      const extra = Math.round((price * formatLine.extraMinutePercent * over) / 100);
      base += extra;
      lines.push({ kind: 'extra_minutes', minutes: over, amountMinor: extra });
    }
  }
  let total = base;
  for (const { id, line } of supplementLines) {
    const percent = line?.percent ?? 0;
    const amountMinor = Math.round((base * percent) / 100);
    total += amountMinor;
    lines.push({ kind: 'supplement', id, percent, amountMinor });
  }
  return { kind: 'price', totalMinor: toEuro(total), lines };
}

/** FNV-1a over the seed's UTF-16 units: the same seed, the same number, on the server and on the screen. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The price of one video already shot, drawn in its line's range and rounded to the euro inside it: the same seed (a
 * video's id), the same price. Pure: when it is drawn and where it is frozen belong to the sale, not to the grid. A
 * range too narrow to hold a round euro gives its low end.
 */
export function readyVideoPriceMinor(
  line: Pick<ReadyVideoLine, 'minMinor' | 'maxMinor'>,
  seed: string,
): number {
  const lowEuro = Math.ceil(line.minMinor / 100);
  const highEuro = Math.floor(line.maxMinor / 100);
  if (highEuro < lowEuro) return line.minMinor;
  return (lowEuro + (hashSeed(seed) % (highEuro - lowEuro + 1))) * 100;
}
