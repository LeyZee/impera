import {
  ApiErrorSchema,
  CONTENT_DROP_EXPORT_UNPROCESSABLE,
  CONTENT_DROP_SETTLED_CONFLICT,
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

export const REDO_ERRORS = {
  forbidden: 'Seuls le propriétaire et un manager actif lui demandent de refaire un dépôt.',
  settled: 'Ce dépôt est déjà publié : il ne se refait plus d’ici.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
} as const;

export type RedoOutcome = { readonly kind: 'ok' } | { readonly kind: 'refused'; readonly message: string };

/**
 * « À refaire » (trou 7 du 21/11): the drop withdrawn with a sentence for her; the request it answered opens again on
 * her screen. Replayed, it answers the same.
 */
export async function redoDrop(
  creatorId: CreatorId,
  dropId: ContentDropId,
  sentence: string,
): Promise<RedoOutcome> {
  let response: Response;
  try {
    response = await fetch(`/v1/creators/${creatorId}/drops/${dropId}/redo`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sentence }),
    });
  } catch {
    return { kind: 'refused', message: REDO_ERRORS.failed };
  }
  if (response.ok) return { kind: 'ok' };
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (refusal.success && refusal.data.error.code === CONTENT_DROP_SETTLED_CONFLICT)
    return { kind: 'refused', message: REDO_ERRORS.settled };
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', message: REDO_ERRORS.forbidden };
  return { kind: 'refused', message: REDO_ERRORS.failed };
}
