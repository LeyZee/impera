import { WEEK_NEEDS, WeekNeedSchema, type WeekNeed } from '@impera/contracts';
import { useState } from 'react';
import { z } from 'zod';

/**
 * The colours of her week, one per kind of thing she shoots (Charles, 20/11: « un code couleur par catégorie »). Each
 * swatch has its night and day tone in `week-card.css`; red and amber stay for urgencies and warnings, never here.
 */
export const SWATCHES = ['rose', 'violet', 'cyan', 'bleu', 'vert', 'or', 'lilas'] as const;
export type Swatch = (typeof SWATCHES)[number];
const SwatchSchema = z.enum(SWATCHES);

/** The words of each swatch, for her screen reader. */
export const SWATCH_WORDS: Readonly<Record<Swatch, string>> = {
  rose: 'Rose',
  violet: 'Violet',
  cyan: 'Cyan',
  bleu: 'Bleu',
  vert: 'Vert',
  or: 'Or',
  lilas: 'Lilas',
};

/** Ours by default: the session pink, the daily videos violet, the stories cyan, the scripts blue, the Mass DM green. */
export const DEFAULT_COLORS: Readonly<Record<WeekNeed, Swatch>> = {
  feed_shoot: 'rose',
  feed_video: 'violet',
  reveal_story: 'cyan',
  script: 'bleu',
  mass_dm: 'vert',
  idea: 'or',
};

const KEY = 'impera.week-colors';
const StoredSchema = z.partialRecord(WeekNeedSchema, SwatchSchema);

/** Her colours as she chose them on this device, ours for the rest; ours alone when nothing can be read. */
export function readColors(): Record<WeekNeed, Swatch> {
  const colors = { ...DEFAULT_COLORS };
  try {
    const text = localStorage.getItem(KEY);
    if (text === null) return colors;
    const stored = StoredSchema.safeParse(JSON.parse(text));
    if (!stored.success) return colors;
    for (const need of WEEK_NEEDS) {
      const swatch = stored.data[need];
      if (swatch !== undefined) colors[need] = swatch;
    }
  } catch {
    // Unreadable: ours.
  }
  return colors;
}

/** Her colours, changed one kind at a time and kept on this device. */
export function useWeekColors(): {
  readonly colors: Readonly<Record<WeekNeed, Swatch>>;
  readonly paint: (need: WeekNeed, swatch: Swatch) => void;
  readonly reset: () => void;
} {
  const [colors, setColors] = useState(readColors);
  const keep = (next: Record<WeekNeed, Swatch>): void => {
    setColors(next);
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Refused: kept for this visit only.
    }
  };
  return {
    colors,
    paint: (need, swatch) => {
      keep({ ...colors, [need]: swatch });
    },
    reset: () => {
      keep({ ...DEFAULT_COLORS });
    },
  };
}
