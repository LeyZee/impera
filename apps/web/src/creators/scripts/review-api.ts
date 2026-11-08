import {
  ApiErrorSchema,
  DropDescriptionsReviewSchema,
  DropDescriptionsSwitchSchema,
  type ContentDropId,
  type CreatorId,
  type DropDescriptionsReview,
  type MediaDescriptionId,
  type ScriptDropSummaryId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * Créatrices › Scripts (SC-04 lot c3): her switch of the descriptions (the owner's, ADR 0083 § 9) and the review of a
 * sent script's descriptions and synthesis (ADR 0030 § 3, ADR 0083 § 7). Every answer is parsed with the contract.
 */

export const switchKey = (creatorId: CreatorId) => ['creators', creatorId, 'drop-descriptions'] as const;
export const reviewKey = (creatorId: CreatorId, dropId: ContentDropId) =>
  ['creators', creatorId, 'drops', dropId, 'descriptions'] as const;

const switchUrl = (creatorId: CreatorId) => `/v1/creators/${creatorId}/drop-descriptions`;
const reviewUrl = (creatorId: CreatorId, dropId: ContentDropId) =>
  `/v1/creators/${creatorId}/drops/${dropId}`;

export function useDescribeSwitch(creatorId: CreatorId, enabled: boolean): UseQueryResult<boolean> {
  return useQuery({
    queryKey: switchKey(creatorId),
    enabled,
    queryFn: async () => {
      const response = await fetch(switchUrl(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET drop-descriptions: ${String(response.status)}`);
      return DropDescriptionsSwitchSchema.parse(await response.json()).on;
    },
    retry: 1,
    retryDelay: 400,
  });
}

export const SWITCH_FAILED =
  'Le serveur ne répond pas : l’interrupteur n’a pas bougé. Réessaie dans un instant.';

/** Her switch turned; `null` when the server did not take it (nothing changed). */
export async function setDescribeSwitch(creatorId: CreatorId, on: boolean): Promise<boolean | null> {
  try {
    const response = await fetch(switchUrl(creatorId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on }),
    });
    if (!response.ok) return null;
    const answer = DropDescriptionsSwitchSchema.safeParse(await response.json().catch(() => null));
    return answer.success ? answer.data.on : null;
  } catch {
    return null;
  }
}

export function useDropReview(
  creatorId: CreatorId,
  dropId: ContentDropId,
  enabled: boolean,
): UseQueryResult<DropDescriptionsReview> {
  return useQuery({
    queryKey: reviewKey(creatorId, dropId),
    enabled,
    queryFn: async () => {
      const response = await fetch(`${reviewUrl(creatorId, dropId)}/descriptions`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`GET descriptions: ${String(response.status)}`);
      return DropDescriptionsReviewSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type ReviewOutcome =
  | { readonly kind: 'ok'; readonly review: DropDescriptionsReview }
  | { readonly kind: 'refused'; readonly message: string };

export const REVIEW_ERRORS = {
  forbidden: 'Seuls le propriétaire et un manager actif relisent les descriptions.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
} as const;

/** The conflict's sentence (a newer row came, a row to see alone, a synthesis no longer the last) is said as it is. */
async function post(url: string, body: object): Promise<ReviewOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'refused', message: REVIEW_ERRORS.failed };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const review = DropDescriptionsReviewSchema.safeParse(json);
    return review.success
      ? { kind: 'ok', review: review.data }
      : { kind: 'refused', message: REVIEW_ERRORS.failed };
  }
  const refusal = ApiErrorSchema.safeParse(json);
  if (response.status === 409 && refusal.success)
    return { kind: 'refused', message: `${refusal.data.error.message}.` };
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', message: REVIEW_ERRORS.forbidden };
  return { kind: 'refused', message: REVIEW_ERRORS.failed };
}

export const validateDescriptions = (
  creatorId: CreatorId,
  dropId: ContentDropId,
  descriptionIds: readonly MediaDescriptionId[],
): Promise<ReviewOutcome> =>
  post(`${reviewUrl(creatorId, dropId)}/descriptions/validate`, { descriptionIds });

export const correctDescription = (
  creatorId: CreatorId,
  dropId: ContentDropId,
  descriptionId: MediaDescriptionId,
  detailed: string,
): Promise<ReviewOutcome> =>
  post(`${reviewUrl(creatorId, dropId)}/descriptions/correct`, { descriptionId, detailed });

export const validateSummary = (
  creatorId: CreatorId,
  dropId: ContentDropId,
  summaryId: ScriptDropSummaryId,
): Promise<ReviewOutcome> => post(`${reviewUrl(creatorId, dropId)}/summary/validate`, { summaryId });
