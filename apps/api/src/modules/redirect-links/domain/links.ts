import { REDIRECT_LINKS_MAX, type LinkPlacement, type RedirectLinkId } from '@impera/contracts';

import type { RedirectLinkFault } from './errors';

/** A redirect link of hers as the module keeps it (ADR 0080 § 4, ADR 0120 § 3, ADR 0121 § 1). */
export interface StoredRedirectLink {
  readonly id: RedirectLinkId;
  readonly name: string;
  readonly url: string;
  /** Where it leads, in the agency's words, for a post to speak of that place. Empty: no place named. */
  readonly destination: string;
  /** Null until the agency says where the link is placed: nothing is attributed to an unplaced link. */
  readonly placement: LinkPlacement | null;
  readonly usageNote: string;
  readonly enabled: boolean;
  /** Attached by the owner to its link at the redirect service: its hours are read. */
  readonly attached: boolean;
}

/** Two names are the same link to the eye: case and outer spaces do not tell them apart. */
function sameName(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), 'fr', { sensitivity: 'accent' }) === 0;
}

/** One address however it is typed: the host in lower case (`URL` does it), no trailing slash. */
export function sameAddress(url: string): string {
  try {
    return new URL(url).href.replace(/\/+$/u, '');
  } catch {
    return url;
  }
}

/**
 * Why a link cannot be kept beside the ones she already has, null when it can: one name and one address per link, and no more than
 * the channel setting ever allowed. `id` is the link being corrected, absent for a new one.
 */
export function writeFault(
  existing: readonly Pick<StoredRedirectLink, 'id' | 'name' | 'url'>[],
  write: { readonly id?: RedirectLinkId; readonly name: string; readonly url: string },
): RedirectLinkFault | null {
  const others = existing.filter((link) => link.id !== write.id);
  if (write.id !== undefined && others.length === existing.length) return 'link_not_found';
  if (others.some((link) => sameName(link.name, write.name))) return 'name_taken';
  if (others.some((link) => sameAddress(link.url) === sameAddress(write.url))) return 'url_taken';
  if (write.id === undefined && existing.length >= REDIRECT_LINKS_MAX) return 'too_many_links';
  return null;
}

/**
 * The link of the redirect service a link of hers is attached to: the one with exactly her link's address, or null.
 * The reference kept is the service's own answer for that address, never something a browser sent.
 */
export function serviceLinkOf<Detected extends { readonly url: string }>(
  link: Pick<StoredRedirectLink, 'url'>,
  detected: readonly Detected[],
): Detected | null {
  const address = sameAddress(link.url);
  return detected.find((one) => sameAddress(one.url) === address) ?? null;
}
