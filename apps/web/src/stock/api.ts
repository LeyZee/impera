import {
  ApiErrorSchema,
  ContentStockSchema,
  DropDescriptionsReviewSchema,
  type ContentDropFileId,
  type ContentDropId,
  type ContentStock,
  type CreatorId,
  type DropDescriptionsReview,
  type MediaDescriptionId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * Coffre Impera (ADR 0163): her stock and her media's descriptions, read through the agency's door for the owner and a
 * manager (`team`), through her own for her (`self`). The two doors answer the same shapes; every answer is parsed.
 */
export type StockDoor = { readonly kind: 'team'; readonly creatorId: CreatorId } | { readonly kind: 'self' };

const doorKey = (door: StockDoor): string => (door.kind === 'team' ? door.creatorId : 'self');

export const stockKey = (door: StockDoor) => ['stock', doorKey(door)] as const;
export const mediumReviewKey = (door: StockDoor, dropId: ContentDropId) =>
  ['stock', doorKey(door), 'drops', dropId, 'descriptions'] as const;

const stockUrl = (door: StockDoor): string =>
  door.kind === 'team' ? `/v1/creators/${door.creatorId}/stock` : '/v1/creator-space/stock';
const dropUrl = (door: StockDoor, dropId: ContentDropId): string =>
  door.kind === 'team'
    ? `/v1/creators/${door.creatorId}/drops/${dropId}`
    : `/v1/creator-space/drops/${dropId}`;

/** Her medium's reduced picture and the medium itself, from our own origin. */
export const stockThumbnailUrl = (
  door: StockDoor,
  dropId: ContentDropId,
  fileId: ContentDropFileId,
): string => `${dropUrl(door, dropId)}/files/${fileId}/thumbnail`;
export const stockMediaUrl = (door: StockDoor, dropId: ContentDropId, fileId: ContentDropFileId): string =>
  `${dropUrl(door, dropId)}/files/${fileId}/media`;

export function useStock(door: StockDoor): UseQueryResult<ContentStock> {
  return useQuery({
    queryKey: stockKey(door),
    queryFn: async () => {
      const response = await fetch(stockUrl(door), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET stock: ${String(response.status)}`);
      return ContentStockSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export function useMediumReview(
  door: StockDoor,
  dropId: ContentDropId,
): UseQueryResult<DropDescriptionsReview> {
  return useQuery({
    queryKey: mediumReviewKey(door, dropId),
    queryFn: async () => {
      const response = await fetch(`${dropUrl(door, dropId)}/descriptions`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET descriptions: ${String(response.status)}`);
      return DropDescriptionsReviewSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type StockReviewOutcome =
  | { readonly kind: 'ok'; readonly review: DropDescriptionsReview }
  | { readonly kind: 'refused'; readonly message: string };

export const STOCK_REVIEW_ERRORS = {
  gone: 'Ce média n’est plus dans le coffre.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
} as const;

async function post(url: string, body: object): Promise<StockReviewOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'refused', message: STOCK_REVIEW_ERRORS.failed };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const review = DropDescriptionsReviewSchema.safeParse(json);
    return review.success
      ? { kind: 'ok', review: review.data }
      : { kind: 'refused', message: STOCK_REVIEW_ERRORS.failed };
  }
  const refusal = ApiErrorSchema.safeParse(json);
  // A newer description came meanwhile: its sentence, as it is.
  if (response.status === 409 && refusal.success)
    return { kind: 'refused', message: `${refusal.data.error.message}.` };
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', message: STOCK_REVIEW_ERRORS.gone };
  return { kind: 'refused', message: STOCK_REVIEW_ERRORS.failed };
}

/** « C'est bien ça »: the description shown, validated in the name of whoever reads it. */
export const validateMedium = (
  door: StockDoor,
  dropId: ContentDropId,
  descriptionId: MediaDescriptionId,
): Promise<StockReviewOutcome> =>
  post(`${dropUrl(door, dropId)}/descriptions/validate`, { descriptionIds: [descriptionId] });

/** « Corriger »: her words, or her team's, over the description shown; validated as they are saved. */
export const correctMedium = (
  door: StockDoor,
  dropId: ContentDropId,
  descriptionId: MediaDescriptionId,
  detailed: string,
): Promise<StockReviewOutcome> =>
  post(`${dropUrl(door, dropId)}/descriptions/correct`, { descriptionId, detailed });
