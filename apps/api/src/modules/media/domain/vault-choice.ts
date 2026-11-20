/**
 * The vault by choice (ADR 0145 § 5, amendment of 17/11): what enters the CRM is ticked by the owner, and a media is
 * described only on her request, after its count and its cost were shown. Pure: the store reads, this decides.
 */

import { DESCRIPTION_TRIES, VAULT_DESCRIBE_COST_TENTHS, type VaultDescriptionState } from '@impera/contracts';

/** A vault media named in a request, as its link says it now. */
export interface DescribeCandidate {
  readonly platformMediaId: string;
  readonly kind: 'image' | 'video' | 'audio';
  readonly removed: boolean;
  readonly imported: boolean;
  /** Its file is read and kept: it has its description, or the media of the same bytes has. */
  readonly linked: boolean;
  readonly asked: boolean;
  readonly failures: number;
}

/** What a request would start, before it starts. */
export interface DescribeEstimate {
  readonly count: number;
  readonly photos: number;
  readonly videos: number;
  readonly alreadyDescribed: number;
  readonly alreadyAsked: number;
  readonly notImported: number;
  /** Not in this vault, removed from it, a voice note, or left to the agency after its tries. */
  readonly notDescribable: number;
  readonly costCents: number;
  /** The media that would be asked, in the order given. */
  readonly toAsk: readonly string[];
}

/** Where a media of the vault stands, for the screen. */
export function descriptionStateOf(
  candidate: Omit<DescribeCandidate, 'platformMediaId'>,
): VaultDescriptionState {
  if (candidate.linked) return 'described';
  if (candidate.failures >= DESCRIPTION_TRIES) return 'to_agency';
  return candidate.asked ? 'asked' : 'none';
}

/**
 * The count and the cost of describing these media: only an imported photo or video of the vault, not described yet
 * nor already asked, each once even when named twice. An id the vault does not hold is `notDescribable`.
 */
export function estimateVaultDescriptions(
  asked: readonly string[],
  known: ReadonlyMap<string, DescribeCandidate>,
): DescribeEstimate {
  const counts = {
    alreadyDescribed: 0,
    alreadyAsked: 0,
    notImported: 0,
    notDescribable: 0,
    photos: 0,
    videos: 0,
  };
  const toAsk: string[] = [];
  for (const id of new Set(asked)) {
    const candidate = known.get(id);
    if (candidate === undefined || candidate.removed || candidate.kind === 'audio')
      counts.notDescribable += 1;
    else if (candidate.linked) counts.alreadyDescribed += 1;
    else if (candidate.failures >= DESCRIPTION_TRIES) counts.notDescribable += 1;
    else if (!candidate.imported) counts.notImported += 1;
    else if (candidate.asked) counts.alreadyAsked += 1;
    else {
      toAsk.push(id);
      if (candidate.kind === 'image') counts.photos += 1;
      else counts.videos += 1;
    }
  }
  const tenths =
    counts.photos * VAULT_DESCRIBE_COST_TENTHS.image + counts.videos * VAULT_DESCRIBE_COST_TENTHS.video;
  return { ...counts, count: toAsk.length, costCents: Math.ceil(tenths / 10), toAsk };
}

/** What is left of today's AI cap, in whole cents, never below zero. */
export function capLeftCents(budget: { readonly spentEur: number; readonly capEur: number }): number {
  return Math.max(0, Math.floor((budget.capEur - budget.spentEur) * 100));
}

/** A confirmation holds only for the estimate it was shown: the same count and the same cost. */
export function confirms(
  confirm: { readonly count: number; readonly costCents: number } | null,
  estimate: Pick<DescribeEstimate, 'count' | 'costCents'>,
): boolean {
  return (
    confirm !== null &&
    estimate.count > 0 &&
    confirm.count === estimate.count &&
    confirm.costCents === estimate.costCents
  );
}

/** The excerpt of a description the screen shows under a media: its first characters, on a word. */
export function excerptOf(detailed: string | null, max: number): string | null {
  const text = detailed?.replace(/\s+/g, ' ').trim() ?? '';
  if (text === '') return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
