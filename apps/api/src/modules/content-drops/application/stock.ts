import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  DropCategorySchema,
  DropMediaKindSchema,
  DropStateSchema,
  STOCK_MEDIA_LIMIT,
  type ContentStock,
  type StockDescriptionState,
  type StockMedium,
  type StockStanding,
} from '@impera/contracts';

import { PROVEN_GIFT_INTENSITIES } from '../domain/reserved';
import { STOCK_ORDER, stockCategory, type StockCounts } from '../domain/stock';

/** A medium of hers as the store reads it, before it is checked (CLAUDE.md rule 6: Zod at the border). */
export interface StockRow {
  readonly dropId: string;
  readonly fileId: string;
  readonly category: string;
  readonly kind: string;
  readonly dropState: string;
  readonly droppedAt: Date;
  /** When the team put it out (`exported_at`); `null` while it is not out. */
  readonly outAt: Date | null;
  readonly erasesAt: Date | null;
  readonly durationMs: number | null;
  readonly description: StockDescriptionState;
  /** The intensity of the description it shows (`content.intensity`), for the gift guard. */
  readonly intensity: string | null;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** A gift is never nude (ADR 0163 § 2): what the vision or a person said explicit or hard is not a gift. */
const NOT_A_GIFT: ReadonlySet<string> = new Set(['explicit', 'hardcore']);

function standingOf(dropState: string, outAt: Date | null): StockStanding {
  if (outAt !== null || DropStateSchema.parse(dropState) === 'published') return 'out';
  return dropState === 'scheduled' ? 'scheduled' : 'stock';
}

/**
 * Her stock by use (ADR 0163 § 3): each category counted against its rule, and her newest media. A gift is counted
 * only once described soft or suggestive; one said nude is shown, flagged, and never counted (§ 2).
 */
export function contentStockOf(rows: readonly StockRow[], now: Date): ContentStock {
  const unproven = new Set(
    rows
      .filter(
        (row) =>
          row.category === 'whale_gift' &&
          (row.intensity === null || !PROVEN_GIFT_INTENSITIES.has(row.intensity)),
      )
      .map((row) => row.fileId),
  );
  const media: StockMedium[] = rows.map((row) => {
    const category = DropCategorySchema.parse(row.category);
    return {
      dropId: ContentDropIdSchema.parse(row.dropId),
      fileId: ContentDropFileIdSchema.parse(row.fileId),
      category,
      kind: DropMediaKindSchema.parse(row.kind),
      standing: standingOf(row.dropState, row.outAt),
      droppedAt: row.droppedAt.toISOString(),
      outAt: row.outAt?.toISOString() ?? null,
      description: row.description,
      erasesAt: row.erasesAt?.toISOString() ?? null,
      durationMs: row.durationMs,
      notAGift: category === 'whale_gift' && row.intensity !== null && NOT_A_GIFT.has(row.intensity),
    };
  });
  const since = now.getTime() - WEEK_MS;
  const categories = STOCK_ORDER.map((category) => {
    const mine = media.filter((m) => m.category === category && !unproven.has(m.fileId));
    const drops = (standing: StockStanding, recent = false): ReadonlySet<string> =>
      new Set(
        mine
          .filter(
            (m) => m.standing === standing && (!recent || (m.outAt !== null && Date.parse(m.outAt) >= since)),
          )
          .map((m) => m.dropId),
      );
    const files = (standing: StockStanding, recent = false): number =>
      mine.filter(
        (m) => m.standing === standing && (!recent || (m.outAt !== null && Date.parse(m.outAt) >= since)),
      ).length;
    const counts: StockCounts = {
      stockDrops: drops('stock').size,
      stockFiles: files('stock'),
      scheduledDrops: drops('scheduled').size,
      scheduledFiles: files('scheduled'),
      outDrops7: drops('out', true).size,
      outFiles7: files('out', true),
    };
    return stockCategory(category, counts);
  });
  return { asOf: now.toISOString(), categories, media: media.slice(0, STOCK_MEDIA_LIMIT) };
}
