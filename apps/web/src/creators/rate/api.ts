import {
  ApiErrorSchema,
  CreatorAgencyRateListSchema,
  CreatorAgencyRateSchema,
  type AgencyRateErrorCode,
  type CreateCreatorAgencyRateBody,
  type CreatorAgencyRate,
  type CreatorAgencyRateList,
  type CreatorId,
} from '@nirvana/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:id/agency-rates` (CR-04), the owner's alone. Every answer is parsed with the contract: a shape the
 * page does not expect reads as « Le serveur ne répond pas », never as a guess.
 */

/** Why a call failed, as the page says it. */
export type RateErrorKind =
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'day_invalid'
  | 'day_taken'
  | 'conflict'
  | 'refused'
  | 'unavailable';

export const RATE_ERRORS: Readonly<Record<RateErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi, puis recommence : rien n’a été enregistré.',
  forbidden: 'Seul le compte propriétaire lit et pose le pourcentage de l’agence.',
  not_found: 'Cette créatrice n’existe plus.',
  day_invalid:
    'Ce jour a commencé : un nouveau pourcentage part de demain au plus tôt, jamais en arrière. Rien n’a été enregistré.',
  day_taken:
    'Elle a déjà un pourcentage à partir de ce jour. Choisis un autre jour : rien n’a été enregistré.',
  conflict: 'Ce pourcentage vient d’être posé avec d’autres valeurs. Recharge la page pour le voir.',
  refused: 'Ce pourcentage ne passe pas : de 0 à 100 %, deux décimales au plus.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a été enregistré.',
};

export class RateError extends Error {
  readonly kind: RateErrorKind;

  constructor(kind: RateErrorKind, detail: string) {
    super(`${RATE_ERRORS[kind]} (${detail})`);
    this.name = 'RateError';
    this.kind = kind;
  }
}

/** The sentence of a failed call; anything that is not a `RateError` is the server not answering. */
export const rateErrorKind = (error: unknown): RateErrorKind =>
  error instanceof RateError ? error.kind : 'unavailable';

const CODE_KINDS: ReadonlyMap<string, RateErrorKind> = new Map<AgencyRateErrorCode, RateErrorKind>([
  ['agency_rate_day_invalid', 'day_invalid'],
  ['agency_rate_day_conflict', 'day_taken'],
  ['agency_rate_conflict', 'conflict'],
]);

const path = (creatorId: CreatorId): string => `/v1/creators/${encodeURIComponent(creatorId)}/agency-rates`;

async function call(creatorId: CreatorId, init: RequestInit = {}): Promise<unknown> {
  const what = `${init.method ?? 'GET'} agency-rates`;
  let response: Response;
  try {
    response = await fetch(path(creatorId), { credentials: 'include', ...init });
  } catch {
    throw new RateError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.ok) return response.json().catch(() => null);
  if (response.status === 401) throw new RateError('session_expired', detail);
  if (response.status === 403) throw new RateError('forbidden', detail);
  if (response.status === 404) throw new RateError('not_found', detail);
  if (response.status === 400 || response.status === 409) {
    const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    const code = body.success ? body.data.error.code : '';
    const kind = CODE_KINDS.get(code);
    throw new RateError(kind ?? (response.status === 400 ? 'refused' : 'conflict'), detail);
  }
  throw new RateError('unavailable', detail);
}

export const ratesQueryKey = (creatorId: CreatorId): readonly string[] => ['agency-rates', creatorId];

/** Her percentages newest first, the agency's day, and the one in force (`null`: « à régler »). */
export async function fetchAgencyRates(creatorId: CreatorId): Promise<CreatorAgencyRateList> {
  const list = CreatorAgencyRateListSchema.safeParse(await call(creatorId));
  if (list.success) return list.data;
  throw new RateError('unavailable', 'GET agency-rates: réponse inattendue');
}

export function useAgencyRates(creatorId: CreatorId): UseQueryResult<CreatorAgencyRateList> {
  // One retry, not three: « Le serveur ne répond pas » comes in under two seconds instead of a long skeleton (CREA-30).
  return useQuery({
    queryKey: ratesQueryKey(creatorId),
    queryFn: () => fetchAgencyRates(creatorId),
    retry: 1,
    retryDelay: 400,
  });
}

/** Adds a percentage; its `id` is made once per form, so a retry records it once. */
export async function addAgencyRate(
  creatorId: CreatorId,
  body: CreateCreatorAgencyRateBody,
): Promise<CreatorAgencyRate> {
  const rate = CreatorAgencyRateSchema.safeParse(
    await call(creatorId, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  if (rate.success) return rate.data;
  throw new RateError('unavailable', 'POST agency-rates: réponse inattendue');
}
