import { CREATOR_TASK_CATEGORY_LABELS, type CreatorTaskCategory } from '@impera/contracts';
import type { JSX } from 'react';

/*
 * A category at a glance (Charles, 03/11, 18 h 25): a colour and an emoji in a tinted tile at the start of a row,
 * never a coloured bar on the edge of a card. The colour is `--ag-c` of `[data-cat]` (agenda.css); the emoji is
 * decoration, the label is what is read.
 */

export const CATEGORY_EMOJI: Readonly<Record<CreatorTaskCategory, string>> = {
  shoot: '🎬',
  live: '📡',
  post: '🖼️',
  socials: '💬',
  appointment: '📅',
  personal: '🌿',
};

/** The tile of a category: its emoji on its colour, hidden from a screen reader (the label says it). */
export function CategoryMark({
  category,
  size = 'md',
}: {
  category: CreatorTaskCategory;
  size?: 'sm' | 'md' | 'lg';
}): JSX.Element {
  return (
    <span className="ag-mark" data-cat={category} data-size={size} aria-hidden="true">
      {CATEGORY_EMOJI[category]}
    </span>
  );
}

export const categoryLabel = (category: CreatorTaskCategory): string =>
  CREATOR_TASK_CATEGORY_LABELS[category];
