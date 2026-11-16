import { VaultSyncAskedSchema, VaultViewSchema, type CreatorId, type VaultView } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/** `/v1/creators/:creatorId/vault` (ADR 0099 §§ 2-4): her vault as read, and the owner's sync. Parsed with the contract. */

export const vaultKey = (creatorId: CreatorId) => ['creators', creatorId, 'vault'] as const;

export function useVault(creatorId: CreatorId, pollMs: number | false): UseQueryResult<VaultView> {
  return useQuery({
    queryKey: vaultKey(creatorId),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/vault`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET vault: ${String(response.status)}`);
      return VaultViewSchema.parse(await response.json());
    },
    refetchInterval: pollMs,
    retry: 1,
    retryDelay: 400,
  });
}

/** Asks a sync of each of her accounts that may be read now: how many, or `null` when it did not go. */
export async function askVaultSync(creatorId: CreatorId): Promise<number | null> {
  try {
    const response = await fetch(`/v1/creators/${creatorId}/vault/sync`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) return null;
    const asked = VaultSyncAskedSchema.safeParse(await response.json().catch(() => null));
    return asked.success ? asked.data.accounts : null;
  } catch {
    return null;
  }
}

/**
 * ADR 0138: a media's sharp small picture, read at Reveal by the server when asked and never kept; from our own origin
 * (the CRM's CSP). Asked only by a gesture: « Voir net », the pointer on a media, its sheet.
 */
export const vaultPreviewUrl = (creatorId: CreatorId, platformMediaId: string): string =>
  `/v1/creators/${encodeURIComponent(creatorId)}/vault/media/${encodeURIComponent(platformMediaId)}/preview`;
