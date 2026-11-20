import { LinkRefSchema, RedirectLinkIdSchema, newId, type DetectedLink } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { linkProposals, placementHint } from '../detection';

const found = (ref: string, name: string, path: string): DetectedLink => ({
  ref: LinkRefSchema.parse(ref),
  name,
  url: `https://liens.example/${path}`,
});

describe('where a detected link is likely placed (ADR 0120 § 3)', () => {
  it('reads the place in the name the agency gave the link', () => {
    expect(placementHint('Insta (Story du jour)')).toBe('story_daily');
    expect(placementHint('Daily story')).toBe('story_daily');
    expect(placementHint('Story à la une')).toBe('story_highlight');
    expect(placementHint('Highlight story')).toBe('story_highlight');
    expect(placementHint('Canal Télégram')).toBe('telegram_channel');
    expect(placementHint('TikTok bio')).toBe('other_network');
  });

  it('makes up no place when the name says nothing', () => {
    expect(placementHint('Lien principal')).toBeNull();
    expect(placementHint('')).toBeNull();
    expect(placementHint('Histoire du jour')).toBeNull();
  });
});

describe('the proposals of « Détecter ses liens »', () => {
  const kept = {
    id: newId(RedirectLinkIdSchema),
    name: 'Story à la une',
    url: 'https://liens.example/une',
    placement: 'story_highlight' as const,
  };

  it('prefills a new link and recognises one she already has by its address', () => {
    const proposals = linkProposals(
      [found('r1', 'Peu importe', 'UNE/'.toLowerCase()), found('r2', '  Insta   story du jour ', 'jour')],
      [kept],
    );
    expect(proposals).toEqual([
      {
        ref: 'r2',
        name: 'Insta story du jour',
        url: 'https://liens.example/jour',
        placement: 'story_daily',
        knownAs: null,
      },
      {
        ref: 'r1',
        name: 'Story à la une',
        url: 'https://liens.example/une/',
        placement: 'story_highlight',
        knownAs: kept.id,
      },
    ]);
  });

  it('proposes an address once, cuts a long name and names an unnamed link', () => {
    const proposals = linkProposals(
      [found('r1', 'x'.repeat(90), 'a'), found('r2', 'doublon', 'a'), found('r3', '   ', 'b')],
      [],
    );
    expect(proposals.map((proposal) => proposal.ref)).toEqual(['r3', 'r1']);
    expect(proposals[0]?.name).toBe('Lien 2');
    expect(proposals[1]?.name).toHaveLength(60);
  });

  it('removes control characters and invisible direction marks from a name of the service', () => {
    const [proposal] = linkProposals([found('r1', 'Lien\u202E du\u0000 jour\u200B\n', 'a')], []);
    expect(proposal?.name).toBe('Lien du jour');
    expect(linkProposals([found('r1', '\u202E\u200F', 'a')], [])[0]?.name).toBe('Lien 1');
  });

  it('proposes nothing when the service lists nothing', () => {
    expect(linkProposals([], [kept])).toEqual([]);
  });
});
