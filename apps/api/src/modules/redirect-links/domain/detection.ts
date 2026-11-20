import type { DetectedLink, LinkPlacement, LinkProposal } from '@impera/contracts';

import { sameAddress, type StoredRedirectLink } from './links';

/** The longest name a link of hers is kept with (`RedirectLinkSchema`). */
const NAME_MAX = 60;

/** A name as it is compared: lower case, accents and punctuation gone, one space between words. */
function plain(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

const HINTS: readonly (readonly [RegExp, LinkPlacement])[] = [
  [/\bstor(y|ies)\b.*\b(jour|daily|quotidien(ne)?)\b|\b(jour|daily)\b.*\bstor(y|ies)\b/u, 'story_daily'],
  [
    /\bstor(y|ies)\b.*\b(une|highlight|epingle(e)?)\b|\b(une|highlight)\b.*\bstor(y|ies)\b/u,
    'story_highlight',
  ],
  [/\btelegram\b/u, 'telegram_channel'],
  [/\b(tiktok|twitter|snapchat|snap|reddit|threads|youtube|facebook|twitch)\b/u, 'other_network'],
];

/**
 * Where a link is likely placed, read in the name the agency gave it at the service (ADR 0120 § 3): a hint, shown
 * prefilled and corrected by a person. Null when the name says nothing: the screen shows « à renseigner », and no
 * place is made up.
 */
export function placementHint(name: string): LinkPlacement | null {
  const words = plain(name);
  return HINTS.find(([pattern]) => pattern.test(words))?.[1] ?? null;
}

/**
 * The name proposed for a detected link: the service's, trimmed and cut; a name left empty becomes « Lien n ». The
 * name comes from a third party and ends on a screen: control characters and invisible marks (direction overrides
 * among them) are removed first.
 */
function proposedName(name: string, rank: number): string {
  const kept = name
    .replace(/[\p{Cc}\p{Cf}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .slice(0, NAME_MAX)
    .replace(/[\uD800-\uDBFF]$/u, '')
    .trim();
  return kept === '' ? `Lien ${String(rank)}` : kept;
}

/**
 * The proposals of « Détecter ses liens »: one per address found at the service, the links we do not keep yet
 * first, then by name. A link whose address she already has keeps her own name and place (`knownAs`); a new one gets
 * a name and a place prefilled by the code. Nothing here writes: a person confirms each link.
 */
export function linkProposals(
  detected: readonly DetectedLink[],
  existing: readonly Pick<StoredRedirectLink, 'id' | 'name' | 'url' | 'placement'>[],
): LinkProposal[] {
  const seen = new Set<string>();
  const proposals: LinkProposal[] = [];
  for (const link of detected) {
    const address = sameAddress(link.url);
    if (seen.has(address)) continue;
    seen.add(address);
    const known = existing.find((one) => sameAddress(one.url) === address);
    proposals.push(
      known
        ? { ref: link.ref, name: known.name, url: link.url, placement: known.placement, knownAs: known.id }
        : {
            ref: link.ref,
            name: proposedName(link.name, proposals.length + 1),
            url: link.url,
            placement: placementHint(link.name),
            knownAs: null,
          },
    );
  }
  return proposals.sort(
    (a, b) => Number(a.knownAs !== null) - Number(b.knownAs !== null) || a.name.localeCompare(b.name, 'fr'),
  );
}
