import {
  ApiErrorSchema,
  CONTENT_DROP_EXPORT_UNPROCESSABLE,
  ContentDropSchema,
  type ContentDropId,
  type CreatorId,
} from '@impera/contracts';

import type { ConfirmOutcome } from '@/creators/scripts/api';

/**
 * Créatrices › Contenu (recette créatrice 1): the archive of a drop of hers and « Publié », once. Every answer is
 * parsed with the contract.
 */

/** The archive's address: the browser downloads it as it is zipped, never held whole by the page. */
export const dropArchiveHref = (creatorId: CreatorId, dropId: ContentDropId): string =>
  `/v1/creators/${creatorId}/drops/${dropId}/export`;

export const OUT_ERRORS = {
  forbidden: 'Seuls le propriétaire et un manager actif confirment une publication.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
} as const;

/** Said out once: replayed, it answers the same confirmation. */
export async function confirmOut(creatorId: CreatorId, dropId: ContentDropId): Promise<ConfirmOutcome> {
  let response: Response;
  try {
    response = await fetch(`${dropArchiveHref(creatorId, dropId)}/confirm`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    return { kind: 'refused', message: OUT_ERRORS.failed };
  }
  if (response.ok) {
    const drop = ContentDropSchema.safeParse(await response.json().catch(() => null));
    return drop.success ? { kind: 'ok', drop: drop.data } : { kind: 'refused', message: OUT_ERRORS.failed };
  }
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  // The server's sentence says why (an original already erased, her files not all settled): said as it is.
  if (refusal.success && refusal.data.error.code === CONTENT_DROP_EXPORT_UNPROCESSABLE)
    return { kind: 'refused', message: `${refusal.data.error.message}.` };
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', message: OUT_ERRORS.forbidden };
  return { kind: 'refused', message: OUT_ERRORS.failed };
}
