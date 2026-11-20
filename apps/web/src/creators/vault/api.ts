import {
  VaultChoicesViewSchema,
  VaultDescribeAnswerSchema,
  VaultSyncAskedSchema,
  VaultViewSchema,
  type CreatorId,
  type VaultChoicesChange,
  type VaultChoicesView,
  type VaultDescribeAnswer,
  type VaultDescribeAsk,
  type VaultView,
} from '@impera/contracts';
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

/**
 * `/v1/creators/:creatorId/vault/choices` (ADR 0145 § 5): what of her vault enters the CRM, and where each media's
 * description stands. Under the vault's key, so a sync read again reads them again too.
 */
export const vaultChoicesKey = (creatorId: CreatorId) => [...vaultKey(creatorId), 'choices'] as const;

export function useVaultChoices(
  creatorId: CreatorId,
  pollMs: number | false,
): UseQueryResult<VaultChoicesView> {
  return useQuery({
    queryKey: vaultChoicesKey(creatorId),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/vault/choices`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET vault choices: ${String(response.status)}`);
      return VaultChoicesViewSchema.parse(await response.json());
    },
    refetchInterval: pollMs,
    retry: 1,
    retryDelay: 400,
  });
}

/** The owner ticks or unticks a folder whole or media one by one: the choices as they now stand, `null` when refused. */
export async function putVaultChoices(
  creatorId: CreatorId,
  change: VaultChoicesChange,
): Promise<VaultChoicesView | null> {
  try {
    const response = await fetch(`/v1/creators/${creatorId}/vault/choices`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(change),
    });
    if (!response.ok) return null;
    const view = VaultChoicesViewSchema.safeParse(await response.json().catch(() => null));
    return view.success ? view.data : null;
  } catch {
    return null;
  }
}

/**
 * « Décrire par IA », in two steps under one key per gesture: without `confirm` the count and the cost, with them the
 * run. `null` when the server refused or did not answer: nothing was asked.
 */
export async function askVaultDescribe(
  creatorId: CreatorId,
  ask: VaultDescribeAsk,
): Promise<VaultDescribeAnswer | null> {
  try {
    const response = await fetch(`/v1/creators/${creatorId}/vault/describe`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ask),
    });
    if (!response.ok) return null;
    const answer = VaultDescribeAnswerSchema.safeParse(await response.json().catch(() => null));
    return answer.success ? answer.data : null;
  } catch {
    return null;
  }
}
