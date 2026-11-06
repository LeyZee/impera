import {
  ApiErrorSchema,
  CONTENT_DROP_EXPORT_UNPROCESSABLE,
  ContentDropSchema,
  CreatorContentSchema,
  type ContentDrop,
  type ContentDropId,
  type CreatorContent,
  type CreatorId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * Créatrices › Scripts (SC-03 c2b), the owner's and an active manager's: her content as the agency reads it, the
 * archive of a sent script and « Copié dans Reveal ». Every answer is parsed with the contract.
 */

export const contentKey = (creatorId: CreatorId) => ['creators', creatorId, 'content'] as const;

export function useCreatorContent(creatorId: CreatorId): UseQueryResult<CreatorContent> {
  return useQuery({
    queryKey: contentKey(creatorId),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/content`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET content: ${String(response.status)}`);
      return CreatorContentSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

/** The archive's address: the browser downloads it as it is zipped, never held whole by the page (10 Gio videos). */
export const archiveHref = (creatorId: CreatorId, dropId: ContentDropId): string =>
  `/v1/creators/${creatorId}/drops/${dropId}/script-export`;

export type ConfirmOutcome =
  | { readonly kind: 'ok'; readonly drop: ContentDrop }
  | { readonly kind: 'refused'; readonly message: string };

export const CONFIRM_ERRORS = {
  forbidden: 'Seuls le propriétaire et un manager actif confirment une copie dans Reveal.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
} as const;

/** « Copié dans Reveal », once: replayed, it answers the same confirmation. */
export async function confirmCopied(creatorId: CreatorId, dropId: ContentDropId): Promise<ConfirmOutcome> {
  let response: Response;
  try {
    response = await fetch(`${archiveHref(creatorId, dropId)}/confirm`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    return { kind: 'refused', message: CONFIRM_ERRORS.failed };
  }
  if (response.ok) {
    const drop = ContentDropSchema.safeParse(await response.json().catch(() => null));
    return drop.success
      ? { kind: 'ok', drop: drop.data }
      : { kind: 'refused', message: CONFIRM_ERRORS.failed };
  }
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  // The server's sentence says why (an original already erased, her media not all kept): said as it is.
  if (refusal.success && refusal.data.error.code === CONTENT_DROP_EXPORT_UNPROCESSABLE) {
    return { kind: 'refused', message: `${refusal.data.error.message}.` };
  }
  if (response.status === 403 || response.status === 404) {
    return { kind: 'refused', message: CONFIRM_ERRORS.forbidden };
  }
  return { kind: 'refused', message: CONFIRM_ERRORS.failed };
}
