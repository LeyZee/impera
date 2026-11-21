import { WEEK_NEEDS } from '@impera/contracts';
import { useSyncExternalStore, type CSSProperties } from 'react';
import { z } from 'zod';

/**
 * The colours of her week and her day, one per kind of thing she shoots and per network she posts on (Charles, 20/11:
 * « un code couleur par catégorie… ou par plateforme »). Each swatch has its night and day tone in `week-card.css`;
 * red and amber stay for urgencies and warnings, never here. One store for the page: a colour changed in one card is
 * the colour of the other at once.
 */
export const SWATCHES = ['rose', 'violet', 'cyan', 'bleu', 'vert', 'citron', 'lilas'] as const;
export type Swatch = (typeof SWATCHES)[number];
const SwatchSchema = z.enum(SWATCHES);

/** What she colours: what she shoots, and the two networks of her day. */
export const COLOR_KINDS = [...WEEK_NEEDS, 'instagram', 'telegram'] as const;
export type ColorKind = (typeof COLOR_KINDS)[number];
const ColorKindSchema = z.enum(COLOR_KINDS);

/** The words of each swatch, for her screen reader. */
export const SWATCH_WORDS: Readonly<Record<Swatch, string>> = {
  rose: 'Rose',
  violet: 'Violet',
  cyan: 'Cyan',
  bleu: 'Bleu',
  vert: 'Vert',
  citron: 'Citron',
  lilas: 'Lilas',
};

/**
 * Ours by default: the session pink, the daily videos violet, the stories cyan, the scripts blue, the Mass DM green,
 * Instagram lilac, Telegram lime.
 */
export const DEFAULT_COLORS: Readonly<Record<ColorKind, Swatch>> = {
  feed_shoot: 'rose',
  feed_video: 'violet',
  reveal_story: 'cyan',
  script: 'bleu',
  mass_dm: 'vert',
  idea: 'citron',
  instagram: 'lilas',
  telegram: 'citron',
};

const KEY = 'impera.week-colors';
const StoredSchema = z.partialRecord(ColorKindSchema, SwatchSchema);

/** Her colours as she chose them on this device, ours for the rest; ours alone when nothing can be read. */
export function readColors(): Record<ColorKind, Swatch> {
  const colors = { ...DEFAULT_COLORS };
  try {
    const text = localStorage.getItem(KEY);
    if (text === null) return colors;
    const stored = StoredSchema.safeParse(JSON.parse(text));
    if (!stored.success) return colors;
    for (const kind of COLOR_KINDS) {
      const swatch = stored.data[kind];
      if (swatch !== undefined) colors[kind] = swatch;
    }
  } catch {
    // Unreadable: ours.
  }
  return colors;
}

let current: Readonly<Record<ColorKind, Swatch>> | null = null;
const listeners = new Set<() => void>();

function snapshot(): Readonly<Record<ColorKind, Swatch>> {
  current ??= readColors();
  return current;
}

function keep(next: Record<ColorKind, Swatch>): void {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Refused: kept for this visit only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget what was read, so the next reader reads this device again. */
export function forgetColors(): void {
  current = null;
}

/** Her colours, changed one kind at a time and kept on this device. */
export function useWeekColors(): {
  readonly colors: Readonly<Record<ColorKind, Swatch>>;
  readonly paint: (kind: ColorKind, swatch: Swatch) => void;
  readonly reset: (kinds: readonly ColorKind[]) => void;
} {
  const colors = useSyncExternalStore(subscribe, snapshot, snapshot);
  return {
    colors,
    paint: (kind, swatch) => {
      keep({ ...snapshot(), [kind]: swatch });
    },
    reset: (kinds) => {
      const next = { ...snapshot() };
      for (const kind of kinds) next[kind] = DEFAULT_COLORS[kind];
      keep(next);
    },
  };
}

/** The colour variable of each kind shown, for a card's `style`. */
export function colorVars(
  kinds: readonly ColorKind[],
  colors: Readonly<Record<ColorKind, Swatch>>,
): CSSProperties {
  const style: CSSProperties = {};
  for (const kind of kinds) style[`--wk-${kind}`] = `var(--wk-sw-${colors[kind]})`;
  return style;
}
