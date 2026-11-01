import {
  ApiErrorSchema,
  CreatorListSchema,
  CreatorSummarySchema,
  REAUTHENTICATION_ERROR_CODE,
  type CreatorErrorCode,
  type CreatorId,
  type CreatorSummary,
} from '@nirvana/contracts';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

/** `GET /v1/creators`: the creators the signed-in user may open, parsed with the contract. */
export async function fetchCreators(): Promise<CreatorSummary[]> {
  const response = await fetch('/v1/creators', { credentials: 'include' });
  if (!response.ok) throw new Error(`GET /v1/creators: ${String(response.status)}`);
  return CreatorListSchema.parse(await response.json()).creators;
}

/**
 * How the creators are read, by every reader of `['creators']` (the screens and the bar's pill): one retry, not
 * three, so that « Le serveur ne répond pas » comes in under two seconds instead of a long skeleton (CREA-30). A
 * reader with other options would set them for all, the first one rendered winning.
 */
export const creatorsQuery = queryOptions({
  queryKey: ['creators'],
  queryFn: fetchCreators,
  retry: 1,
  retryDelay: 400,
});

/** The creators, read once and shared by every screen that lists them (Créatrices, Suivi). */
export function useCreators(): UseQueryResult<CreatorSummary[]> {
  return useQuery(creatorsQuery);
}

export type CreateResult =
  | { readonly kind: 'created'; readonly creator: CreatorSummary }
  /** 400 on her zone: the browser offered it, the server does not know it. */
  | { readonly kind: 'unknown_zone' }
  /** Any other 400: what was typed is not taken as it is. */
  | { readonly kind: 'invalid' }
  /** 409 `creator_conflict`: this form's id already made a creator under another name. */
  | { readonly kind: 'conflict' }
  /** 409 `creator_name_conflict`: another creator has this name, case, accents and spaces aside. */
  | { readonly kind: 'name_taken' }
  /** 401: the session ended, signing in again is the way out. */
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/** `details` of a 400 `request_invalid`, as the API's error handler writes it. */
const RefusedFieldsSchema = z.object({ fields: z.array(z.object({ path: z.string() })) });

/**
 * `POST /v1/creators` (owner only): a new creator, her persona still to write. `id` is chosen once per form: sent twice
 * (double click, retry), the server answers the creator it already made.
 */
export async function createCreator(
  id: CreatorId,
  displayName: string,
  timezone: string,
): Promise<CreateResult> {
  const response = await fetch('/v1/creators', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, displayName, timezone }),
  });
  if (response.status === 201) {
    return { kind: 'created', creator: CreatorSummarySchema.parse(await response.json()) };
  }
  if (response.status === 401) return { kind: 'expired' };
  if (response.status !== 400 && response.status !== 409) return { kind: 'failed' };
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (response.status === 409) {
    return error.data?.error.code === ('creator_name_conflict' satisfies CreatorErrorCode)
      ? { kind: 'name_taken' }
      : { kind: 'conflict' };
  }
  // `request_invalid` names each refused field by its path (`/timezone`).
  const fields = RefusedFieldsSchema.safeParse(error.data?.error.details);
  const onZone = fields.success && fields.data.fields.some((field) => field.path === '/timezone');
  return onZone ? { kind: 'unknown_zone' } : { kind: 'invalid' };
}

export type MoveResult =
  | { readonly kind: 'moved'; readonly creator: CreatorSummary }
  /** 400: the server does not know this zone. */
  | { readonly kind: 'unknown_zone' }
  /** 403 `reauthentication_forbidden`: the sign-in is over 10 minutes old, the password is asked again. */
  | { readonly kind: 'reauth' }
  /** Any other 403: only the owner moves a creator. */
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/**
 * `PATCH /v1/creators/:creatorId` (owner only, a recent sign-in): her zone, nothing else. Answers her as stored, the
 * zone spelled as the runtime spells it. Nothing behind her is computed again.
 */
export async function moveCreator(creatorId: string, timezone: string): Promise<MoveResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ timezone }),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) {
    const creator = CreatorSummarySchema.safeParse(await response.json().catch(() => null));
    return creator.success ? { kind: 'moved', creator: creator.data } : { kind: 'failed' };
  }
  if (response.status === 400) return { kind: 'unknown_zone' };
  if (response.status === 401) return { kind: 'expired' };
  if (response.status === 404) return { kind: 'not_found' };
  if (response.status === 403) {
    const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    return error.data?.error.code === REAUTHENTICATION_ERROR_CODE
      ? { kind: 'reauth' }
      : { kind: 'forbidden' };
  }
  return { kind: 'failed' };
}
