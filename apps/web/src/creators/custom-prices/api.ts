import {
  CustomPriceGridViewSchema,
  type CreatorId,
  type CustomPriceGrid,
  type CustomPriceGridView,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:id/custom-prices` (ADR 0159 § C), the owner's alone. Every answer is parsed with the contract: a
 * shape the page does not expect reads as « Le serveur ne répond pas », never as a guess.
 */

export type CustomPricesErrorKind =
  'session_expired' | 'forbidden' | 'not_found' | 'conflict' | 'refused' | 'unavailable';

export const CUSTOM_PRICES_ERRORS: Readonly<Record<CustomPricesErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi, puis recommence : rien n’a été enregistré.',
  forbidden: 'Seul le compte propriétaire lit et règle les prix sur mesure.',
  not_found: 'Cette créatrice n’existe plus.',
  conflict:
    'La grille a été enregistrée ailleurs entre-temps. Recharge-la pour voir la dernière version : rien n’a été enregistré.',
  refused: 'Cette grille ne passe pas : vérifie chaque ligne. Rien n’a été enregistré.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a été enregistré.',
};

export class CustomPricesError extends Error {
  readonly kind: CustomPricesErrorKind;

  constructor(kind: CustomPricesErrorKind, detail: string) {
    super(`${CUSTOM_PRICES_ERRORS[kind]} (${detail})`);
    this.name = 'CustomPricesError';
    this.kind = kind;
  }
}

export const customPricesErrorKind = (error: unknown): CustomPricesErrorKind =>
  error instanceof CustomPricesError ? error.kind : 'unavailable';

const path = (creatorId: CreatorId): string => `/v1/creators/${encodeURIComponent(creatorId)}/custom-prices`;

async function call(creatorId: CreatorId, init: RequestInit = {}): Promise<CustomPriceGridView> {
  const what = `${init.method ?? 'GET'} custom-prices`;
  let response: Response;
  try {
    response = await fetch(path(creatorId), { credentials: 'include', ...init });
  } catch {
    throw new CustomPricesError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.status === 401) throw new CustomPricesError('session_expired', detail);
  if (response.status === 403) throw new CustomPricesError('forbidden', detail);
  if (response.status === 404) throw new CustomPricesError('not_found', detail);
  if (response.status === 409) throw new CustomPricesError('conflict', detail);
  if (response.status === 400) throw new CustomPricesError('refused', detail);
  if (!response.ok) throw new CustomPricesError('unavailable', detail);
  const view = CustomPriceGridViewSchema.safeParse(await response.json().catch(() => null));
  if (view.success) return view.data;
  throw new CustomPricesError('unavailable', `${what}: réponse inattendue`);
}

export const customPricesQueryKey = (creatorId: CreatorId): readonly string[] => ['custom-prices', creatorId];

export function useCustomPrices(creatorId: CreatorId, enabled = true): UseQueryResult<CustomPriceGridView> {
  return useQuery({
    queryKey: customPricesQueryKey(creatorId),
    enabled,
    queryFn: () => call(creatorId),
    retry: 1,
    retryDelay: 400,
  });
}

/** A new version of her grid, on the one the screen read. */
export const saveCustomPrices = (
  creatorId: CreatorId,
  baseVersion: number,
  grid: CustomPriceGrid,
): Promise<CustomPriceGridView> =>
  call(creatorId, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseVersion, grid }),
  });
