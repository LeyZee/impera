import type { DropCategory } from '@impera/contracts';
import type { JSX } from 'react';

import { CATEGORY_EMOJIS } from './model';

import { colorVars, useWeekColors, type ColorKind } from '@/screens/agenda/week-colors';
import { Icon } from '@/screens/agenda/week-parts';
import '@/screens/agenda/week-card.css';

/**
 * The Agenda's kind of each category: Instagram and Telegram take their network's colour and mark. A category the
 * Agenda has no colour for (a whale gift, a vocal, a sale video) keeps its emoji, on the same plate in neutral.
 */
export const CATEGORY_KINDS: Readonly<Partial<Record<DropCategory, ColorKind>>> = {
  feed_shoot: 'feed_shoot',
  feed_video: 'feed_video',
  script: 'script',
  mass_dm: 'mass_dm',
  reveal_story: 'reveal_story',
  instagram_story: 'instagram',
  instagram_reel: 'instagram',
  instagram_post: 'instagram',
  telegram_post: 'telegram',
};

/**
 * A category's mark in Contenu: the Agenda's drawn icon on her colour for that kind (choice of 21/11), so a story or a
 * session reads the same on both screens. Decoration: the category's name says it.
 */
export function CategoryIcon({
  category,
  size = 'md',
}: {
  category: DropCategory;
  size?: 'sm' | 'md';
}): JSX.Element {
  const { colors } = useWeekColors();
  const kind = CATEGORY_KINDS[category];
  if (kind === undefined)
    return (
      <span className="wk-kind ct-kind ct-kind--emoji" data-size={size} aria-hidden="true">
        {CATEGORY_EMOJIS[category]}
      </span>
    );
  return (
    <span
      className="wk-kind wk-swatched ct-kind"
      data-need={kind}
      data-size={size}
      style={colorVars([kind], colors)}
      aria-hidden="true"
    >
      <Icon name={kind} />
    </span>
  );
}
