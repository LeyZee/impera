import type { CreatorId, PlatformAccountId, PlatformScript, VaultMedia } from '@impera/contracts';

type PlatformScriptMoment = NonNullable<PlatformScript['moment']>;

/**
 * One media of a creator's vault as the CRM mirrors it (`media_platform_refs`, ADR 0030 § 1, ADR 0099 § 2 to 4): the
 * platform's folder, moment and order, its own text and suggested range. Never a file nor an address.
 */
export interface VaultRefFields {
  readonly platformMediaId: string;
  readonly kind: VaultMedia['kind'];
  readonly folderRef: string | null;
  readonly folderName: string | null;
  readonly folderMoment: PlatformScriptMoment | null;
  /**
   * The platform's rank between uploads of the same time in the same folder, from 0 (ADR 0099 § 3). Not its rank in
   * the whole folder: that one moves at each new upload, and would rewrite every row of the folder at each sync.
   */
  readonly folderPosition: number;
  /** ISO, to the millisecond. */
  readonly platformCreatedAt: string;
  readonly durationSeconds: number | null;
  readonly platformDescription: string | null;
  readonly suggestedMinMinor: number | null;
  readonly suggestedMaxMinor: number | null;
}

/** A stored row: the fields, and whether the platform had stopped listing it. */
export interface StoredVaultRef extends VaultRefFields {
  readonly removed: boolean;
}

/** What one sync writes: the rows new, changed or listed again, and the ids no longer listed. Empty when nothing moved. */
export interface VaultSyncPlan {
  readonly upserts: readonly VaultRefFields[];
  readonly removals: readonly string[];
}

const folderKey = (media: VaultMedia): string => (media.folder === null ? '' : `f:${media.folder.ref.id}`);

/**
 * The read as rows: each media once, its upload time to the millisecond, and its rank among the uploads of the same time
 * of its folder, in the order the platform listed them. A media listed twice (in two folders, or twice in one) is kept
 * where it was listed first; whether Reveal allows a media in two folders is not known, to see at the first real read.
 */
export function vaultRefsOf(read: readonly VaultMedia[]): VaultRefFields[] {
  const seen = new Set<string>();
  const ties = new Map<string, number>();
  const rows: VaultRefFields[] = [];
  for (const media of read) {
    if (seen.has(media.ref.id)) continue;
    seen.add(media.ref.id);
    const createdAt = new Date(media.createdAt).toISOString();
    const tie = `${folderKey(media)}|${createdAt}`;
    const position = ties.get(tie) ?? 0;
    ties.set(tie, position + 1);
    rows.push({
      platformMediaId: media.ref.id,
      kind: media.kind,
      folderRef: media.folder?.ref.id ?? null,
      folderName: media.folder?.name ?? null,
      folderMoment: media.folder?.moment ?? null,
      folderPosition: position,
      platformCreatedAt: createdAt,
      durationSeconds: media.durationSeconds === null ? null : Math.round(media.durationSeconds),
      platformDescription: media.description,
      suggestedMinMinor: media.suggestedPriceMinor?.min ?? null,
      suggestedMaxMinor: media.suggestedPriceMinor?.max ?? null,
    });
  }
  return rows;
}

const FIELDS = [
  'kind',
  'folderRef',
  'folderName',
  'folderMoment',
  'folderPosition',
  'platformCreatedAt',
  'durationSeconds',
  'platformDescription',
  'suggestedMinMinor',
  'suggestedMaxMinor',
] as const satisfies readonly (keyof VaultRefFields)[];

const sameFields = (a: VaultRefFields, b: VaultRefFields): boolean =>
  FIELDS.every((field) => a[field] === b[field]);

/**
 * A whole read of the vault against what the CRM keeps (ADR 0030 § 2): a media new, moved, changed or listed again is
 * written; one no longer listed is marked removed, never deleted, so its descriptions stay; one unchanged writes
 * nothing. Only a whole read may remove: a partial one (one folder) is never given here.
 */
export function planVaultSync(read: readonly VaultMedia[], stored: readonly StoredVaultRef[]): VaultSyncPlan {
  const rows = vaultRefsOf(read);
  const kept = new Map(stored.map((row) => [row.platformMediaId, row]));
  const listed = new Set(rows.map((row) => row.platformMediaId));
  return {
    upserts: rows.filter((row) => {
      const before = kept.get(row.platformMediaId);
      return before === undefined || before.removed || !sameFields(before, row);
    }),
    removals: stored
      .filter((row) => !row.removed && !listed.has(row.platformMediaId))
      .map((row) => row.platformMediaId),
  };
}

/**
 * The platform's order inside a folder (ADR 0099 § 3): by upload time as the platform lists it (newest first, as
 * FakeReveal and the capture show; checked against the vault's screen at the first real read), then the platform's
 * rank between uploads of the same second, then its id. Never our sync time.
 */
export function compareVaultOrder(
  a: Pick<VaultRefFields, 'platformCreatedAt' | 'folderPosition' | 'platformMediaId'>,
  b: Pick<VaultRefFields, 'platformCreatedAt' | 'folderPosition' | 'platformMediaId'>,
): number {
  return (
    b.platformCreatedAt.localeCompare(a.platformCreatedAt) ||
    a.folderPosition - b.folderPosition ||
    a.platformMediaId.localeCompare(b.platformMediaId)
  );
}

/** Folders by name as the agency numbers them (« SCRIPT 2 » before « SCRIPT 10 »), the vault's root last. */
export function compareVaultFolders(
  a: { readonly folderName: string | null; readonly folderRef: string | null },
  b: { readonly folderName: string | null; readonly folderRef: string | null },
): number {
  if (a.folderRef === null || b.folderRef === null)
    return Number(a.folderRef === null) - Number(b.folderRef === null);
  return (
    (a.folderName ?? '').localeCompare(b.folderName ?? '', 'fr', { numeric: true }) ||
    a.folderRef.localeCompare(b.folderRef)
  );
}

/** What one sync wrote, for the job's log: counts only. */
interface VaultSyncOutcome {
  readonly listed: number;
  readonly written: number;
  readonly removed: number;
}

/** A row as the agency's screen reads it, with when the platform stopped listing it. */
export interface VaultRefRow extends VaultRefFields {
  readonly platform: VaultMedia['ref']['platform'];
  readonly platformAccountId: PlatformAccountId;
  readonly removedAt: Date | null;
  readonly lastSyncedAt: Date;
}

/** Her vault as kept, and the latest sync of any of her accounts that went through (`null` before a first one). */
export interface VaultRead {
  readonly rows: readonly VaultRefRow[];
  readonly syncedAt: Date | null;
}

/**
 * `media_platform_refs` (fiche vault-sync). `apply` runs in the creator's tenant: it skips an archived creator (ADR
 * 0071, `null`), reads what is kept for the account, plans and writes in the same transaction, and stamps the account's
 * `vault_synced_at` (the only write when nothing moved). `read` reads as the person, for the owner and an active manager
 * of her list (`null` when refused, before anything is read).
 */
export interface VaultStore {
  apply(
    account: {
      readonly creatorId: CreatorId;
      readonly id: PlatformAccountId;
      readonly platform: VaultMedia['ref']['platform'];
    },
    read: readonly VaultMedia[],
    now: Date,
  ): Promise<VaultSyncOutcome | null>;
  read(creatorId: CreatorId, userId: string): Promise<VaultRead | null>;
}
