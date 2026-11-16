import { z } from 'zod';

import { LINK_PLACEMENTS, LinkPlacementSchema, type LinkPlacement } from './link-stats';
import { RedirectLinkIdSchema, RedirectUrlSchema, labelHasAddress } from './telegram-channel';

/**
 * « Mes liens » (ADR 0121 § 1): what the creator sees of her redirect links. A tool, not a dashboard: a name, what
 * the link is for in the agency's words, the address to copy. Never a figure.
 */

export const LINK_USAGE_NOTE_MAX = 120;

/** What a link is for and when to use it, written by the agency. Words only: never an address (ADR 0080 § 4.5). */
export const LinkUsageNoteSchema = z
  .string()
  .trim()
  .max(LINK_USAGE_NOTE_MAX)
  .refine((text) => !labelHasAddress(text), 'La phrase d’usage se dit sans adresse')
  .default('');

/** One card of « Mes liens ». */
export const CreatorLinkCardSchema = z.object({
  id: RedirectLinkIdSchema,
  name: z.string().min(1).max(60),
  placement: LinkPlacementSchema,
  usageNote: LinkUsageNoteSchema,
  url: RedirectUrlSchema,
});
export type CreatorLinkCard = z.infer<typeof CreatorLinkCardSchema>;

export const CreatorLinksResponseSchema = z.object({ links: z.array(CreatorLinkCardSchema) });
export type CreatorLinksResponse = z.infer<typeof CreatorLinksResponseSchema>;

/** The order of the cards: the link she uses every day first (ADR 0121 § 1). */
const PLACEMENT_ORDER: readonly LinkPlacement[] = [
  'story_daily',
  'story_highlight',
  'telegram_channel',
  'other_network',
];

/** A link as the agency keeps it, before it is shown to her: its place may still be unset, it may be off. */
export interface CreatorLinkCandidate {
  readonly id: CreatorLinkCard['id'];
  readonly name: string;
  readonly placement: LinkPlacement | null;
  readonly usageNote: string;
  readonly url: string;
  readonly enabled: boolean;
}

/**
 * The cards she sees: only links that are on and have a place, ordered by place then by name. A link the agency has
 * not placed yet is not shown (ADR 0121 § 1).
 */
export function creatorLinkCards(candidates: readonly CreatorLinkCandidate[]): CreatorLinkCard[] {
  const cards: CreatorLinkCard[] = [];
  for (const link of candidates) {
    if (!link.enabled || link.placement === null) continue;
    cards.push(
      CreatorLinkCardSchema.parse({
        id: link.id,
        name: link.name,
        placement: link.placement,
        usageNote: link.usageNote,
        url: link.url,
      }),
    );
  }
  return cards.sort(
    (a, b) =>
      PLACEMENT_ORDER.indexOf(a.placement) - PLACEMENT_ORDER.indexOf(b.placement) ||
      a.name.localeCompare(b.name, 'fr'),
  );
}

/** Every place has its rank: a place added to the list without one would sort first by accident. */
export const PLACEMENTS_WITHOUT_ORDER = LINK_PLACEMENTS.filter((place) => !PLACEMENT_ORDER.includes(place));
