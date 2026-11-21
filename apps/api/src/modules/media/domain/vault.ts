/**
 * The order in which the media the owner asked to describe are described (ADR 0113 § 5, ADR 0145 § 5): first the media
 * of the imported scripts that are active, previews included, beginning with the scripts that miss the fewest
 * descriptions (they become proposable first); then those of the other imported scripts; then the rest in the vault's
 * order, the root last. A media of the root is described when she asked it, as any other (17/11: her choice, media by
 * media). Pure: the store reads, this decides.
 */

/** A media of the vault that has no file yet, as `media_platform_refs` keeps it. */
export interface VaultCandidate {
  readonly refId: string;
  readonly platformMediaId: string;
  readonly kind: 'image' | 'video';
  /** `null` at the vault's root. */
  readonly folderRef: string | null;
  readonly folderName: string | null;
  /** ISO, as the platform lists it. */
  readonly platformCreatedAt: string;
  readonly folderPosition: number;
}

/** An imported script of the account, its media in its own order (steps, then previews before what is sold). */
export interface VaultScript {
  readonly scriptId: string;
  readonly active: boolean;
  readonly platformMediaIds: readonly string[];
}

/** At most this many media a run: the account's queue is shared with its polls, which never wait long behind it. */
export const VAULT_LOT = 5;

/** The platform's order inside a folder, as the vault's screen reads it (connectors, `compareVaultOrder`). */
function compareInFolder(a: VaultCandidate, b: VaultCandidate): number {
  return (
    b.platformCreatedAt.localeCompare(a.platformCreatedAt) ||
    a.folderPosition - b.folderPosition ||
    a.platformMediaId.localeCompare(b.platformMediaId)
  );
}

/** Folders by name as the agency numbers them (« SCRIPT 2 » before « SCRIPT 10 »), the root last (`compareVaultFolders`). */
function compareFolders(a: VaultCandidate, b: VaultCandidate): number {
  if (a.folderRef === null || b.folderRef === null)
    return Number(a.folderRef === null) - Number(b.folderRef === null);
  return (
    (a.folderName ?? '').localeCompare(b.folderName ?? '', 'fr', { numeric: true }) ||
    a.folderRef.localeCompare(b.folderRef)
  );
}

/** The vault's own order: folder by folder, each in the platform's order. */
function compareVault(a: VaultCandidate, b: VaultCandidate): number {
  return compareFolders(a, b) || compareInFolder(a, b);
}

interface Rank {
  readonly tier: 0 | 1;
  readonly missing: number;
  readonly scriptId: string;
  readonly place: number;
}

const compareRank = (a: Rank, b: Rank): number =>
  a.tier - b.tier || a.missing - b.missing || a.scriptId.localeCompare(b.scriptId) || a.place - b.place;

/**
 * The candidates in the order they are described (ADR 0113 § 5): each one, the root's included, since only what the
 * owner asked is a candidate (ADR 0145 § 5). A media in several scripts takes its best place. A script's missing descriptions are its
 * media still waiting here: counted once each, a media listed twice in it too.
 */
export function vaultDescribeOrder<T extends VaultCandidate>(
  candidates: readonly T[],
  scripts: readonly VaultScript[],
): T[] {
  const waiting = new Set(candidates.map((candidate) => candidate.platformMediaId));
  const best = new Map<string, Rank>();
  for (const script of scripts) {
    const missing = new Set(script.platformMediaIds.filter((id) => waiting.has(id))).size;
    if (missing === 0) continue;
    for (const [place, id] of script.platformMediaIds.entries()) {
      if (!waiting.has(id)) continue;
      const rank: Rank = { tier: script.active ? 0 : 1, missing, scriptId: script.scriptId, place };
      const known = best.get(id);
      if (known === undefined || compareRank(rank, known) < 0) best.set(id, rank);
    }
  }
  return [...candidates].sort((a, b) => {
    const ra = best.get(a.platformMediaId);
    const rb = best.get(b.platformMediaId);
    if (ra !== undefined && rb !== undefined) return compareRank(ra, rb) || compareVault(a, b);
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return compareVault(a, b);
  });
}

/** An MPEG-TS stream (a vault video read from its HLS segments, ADR 0113 § 3): a sync byte every 188 bytes. */
export function isMpegTs(head: Uint8Array): boolean {
  return head.length >= 189 && head[0] === 0x47 && head[188] === 0x47;
}
