import { z } from 'zod';

import { DropCategorySchema, DropMediaKindSchema } from './content-drops';
import { ContentDropFileIdSchema, ContentDropIdSchema } from './ids';

/*
 * Coffre Impera (ADR 0162): what she dropped, by use, with what is in stock, scheduled and out, against the rhythm the
 * agency asks of her. The same read for the owner, an active manager and herself.
 */

/** Where a stock stands against its target (ADR 0162 § 3). `low` is amber for the agency, never red for her. */
export const STOCK_STATUSES = ['empty', 'low', 'short', 'ok'] as const;
export const StockStatusSchema = z.enum(STOCK_STATUSES);
export type StockStatus = z.infer<typeof StockStatusSchema>;

export const STOCK_PLATFORMS = ['reveal', 'instagram', 'telegram'] as const;
export const StockPlatformSchema = z.enum(STOCK_PLATFORMS);

/** A category of her stock, its stock read against its rule. */
export const StockCategorySchema = z.strictObject({
  category: DropCategorySchema,
  platform: StockPlatformSchema,
  /** `days`: days of advance at a pace; `count`: a minimum to hold; `bonus`: nothing asked of her. */
  mode: z.enum(['days', 'count', 'bonus']),
  /** What one use spends: a whole drop (a boudoir session, a script) or one of its media. */
  unit: z.enum(['drop', 'file']),
  stockUnits: z.int().min(0),
  stockMedia: z.int().min(0),
  scheduledUnits: z.int().min(0),
  outUnits7: z.int().min(0),
  /** Uses asked a week, for `days`; `null` otherwise. */
  perWeek: z.int().min(0).nullable(),
  daysAhead: z.number().min(0).nullable(),
  /** Days of advance for `days`, the minimum for `count`; `null` for a bonus. */
  target: z.number().min(0).nullable(),
  /** Units to drop to reach the target. */
  lacking: z.int().min(0),
  status: StockStatusSchema,
});
export type StockCategory = z.infer<typeof StockCategorySchema>;

/** Where a medium stands: in stock, scheduled, or out (put out by the team). */
export const STOCK_STANDINGS = ['stock', 'scheduled', 'out'] as const;
export const StockStandingSchema = z.enum(STOCK_STANDINGS);
export type StockStanding = z.infer<typeof StockStandingSchema>;

/**
 * Where its description stands: validated by a person, written and waiting for a look, not written yet, or given up by
 * the vision (ADR 0083, recette créatrice anomalie 2).
 */
export const STOCK_DESCRIPTION_STATES = ['validated', 'to_validate', 'pending', 'failed'] as const;
export const StockDescriptionStateSchema = z.enum(STOCK_DESCRIPTION_STATES);
export type StockDescriptionState = z.infer<typeof StockDescriptionStateSchema>;

/** A medium of her stock: never its key nor its address, only what the screen needs to show and open it. */
export const StockMediumSchema = z.strictObject({
  dropId: ContentDropIdSchema,
  fileId: ContentDropFileIdSchema,
  category: DropCategorySchema,
  kind: DropMediaKindSchema,
  standing: StockStandingSchema,
  droppedAt: z.iso.datetime({ offset: true }),
  outAt: z.iso.datetime({ offset: true }).nullable(),
  description: StockDescriptionStateSchema,
  /** When its original is erased (ADR 0055 § 7); `null` when no date is set or it is already gone. */
  erasesAt: z.iso.datetime({ offset: true }).nullable(),
  durationMs: z.int().min(0).nullable(),
  /**
   * A gift the description says is nude (ADR 0162 § 2): it stays in her stock but is never counted nor given as a
   * gift; the team moves it to another category.
   */
  notAGift: z.boolean(),
});
export type StockMedium = z.infer<typeof StockMediumSchema>;

/** `GET /v1/creators/:creatorId/stock` and `GET /v1/creator-space/stock`. Its media newest first, at most 600. */
export const ContentStockSchema = z.strictObject({
  asOf: z.iso.datetime({ offset: true }),
  categories: z.array(StockCategorySchema),
  media: z.array(StockMediumSchema),
});
export type ContentStock = z.infer<typeof ContentStockSchema>;

/** How many media the read returns at most: the newest. */
export const STOCK_MEDIA_LIMIT = 600;
