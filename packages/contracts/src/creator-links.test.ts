import { describe, expect, it } from 'vitest';

import {
  LINK_USAGE_NOTE_MAX,
  LinkUsageNoteSchema,
  PLACEMENTS_WITHOUT_ORDER,
  creatorLinkCards,
  type CreatorLinkCandidate,
} from './creator-links';
import { RedirectLinkIdSchema } from './telegram-channel';

const id = (n: number) => RedirectLinkIdSchema.parse(`00000000-0000-4000-8000-00000000000${String(n)}`);

function link(over: Partial<CreatorLinkCandidate> & { n: number }): CreatorLinkCandidate {
  return {
    id: id(over.n),
    name: over.name ?? `Lien ${String(over.n)}`,
    placement: over.placement === undefined ? 'story_daily' : over.placement,
    usageNote: over.usageNote ?? 'Pour tes stories de tous les jours',
    url: over.url ?? `https://liens.example/fictif-${String(over.n)}`,
    enabled: over.enabled ?? true,
  };
}

describe('LinkUsageNoteSchema', () => {
  it('keeps words, trims them, and is empty by default', () => {
    expect(LinkUsageNoteSchema.parse('  Pour ta story du jour  ')).toBe('Pour ta story du jour');
    expect(LinkUsageNoteSchema.parse(undefined)).toBe('');
  });

  it('refuses an address and a note that is too long', () => {
    expect(LinkUsageNoteSchema.safeParse('Va sur https://liens.example/x').success).toBe(false);
    expect(LinkUsageNoteSchema.safeParse('a'.repeat(LINK_USAGE_NOTE_MAX + 1)).success).toBe(false);
  });
});

describe('creatorLinkCards', () => {
  it('hides a link that is off or has no place yet', () => {
    const cards = creatorLinkCards([
      link({ n: 1 }),
      link({ n: 2, enabled: false }),
      link({ n: 3, placement: null }),
    ]);
    expect(cards.map((card) => card.id)).toEqual([id(1)]);
  });

  it('puts the daily story first, then the highlight, then the rest, by name inside a place', () => {
    const cards = creatorLinkCards([
      link({ n: 1, placement: 'other_network' }),
      link({ n: 2, placement: 'telegram_channel' }),
      link({ n: 3, placement: 'story_highlight' }),
      link({ n: 4, placement: 'story_daily', name: 'B' }),
      link({ n: 5, placement: 'story_daily', name: 'A' }),
    ]);
    expect(cards.map((card) => card.id)).toEqual([id(5), id(4), id(3), id(2), id(1)]);
  });

  it('shows no figure: a card holds a name, a place, a note and an address, nothing else', () => {
    const [card] = creatorLinkCards([link({ n: 1 })]);
    expect(Object.keys(card ?? {}).sort()).toEqual(['id', 'name', 'placement', 'url', 'usageNote']);
  });

  it('ranks every place', () => {
    expect(PLACEMENTS_WITHOUT_ORDER).toEqual([]);
  });
});
