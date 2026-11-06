import {
  ApiErrorSchema,
  CONTENT_REQUEST_CLOSED_CONFLICT,
  CONTENT_REQUEST_DUE_UNPROCESSABLE,
  CONTENT_REQUEST_STRUCTURE_UNPROCESSABLE,
  ContentRequestSchema,
  ScriptCadenceSchema,
  type ContentRequest,
  type ContentRequestId,
  type CreateContentRequestBody,
  type CreatorId,
  type ScriptCadence,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * Créatrices › Demandes (recette MED-09), the owner's and an active manager's: ask her for content, cancel what she
 * has not begun, read and (the owner) set the cadence of her scripts. Every answer is parsed with the contract.
 */

export const cadenceKey = (creatorId: CreatorId) => ['creators', creatorId, 'script-cadence'] as const;

export function useCadence(creatorId: CreatorId): UseQueryResult<ScriptCadence> {
  return useQuery({
    queryKey: cadenceKey(creatorId),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/script-cadence`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET script-cadence: ${String(response.status)}`);
      return ScriptCadenceSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type Outcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'refused'; readonly field: 'dueOn' | 'structureId' | null; readonly message: string };

const FAILED = 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.';
const FORBIDDEN = 'Seuls le propriétaire et un manager actif font les demandes d’une créatrice.';

async function send<T>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: unknown,
  read: (json: unknown) => T,
): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    return { kind: 'refused', field: null, message: FAILED };
  }
  if (response.ok) {
    try {
      return { kind: 'ok', value: read(response.status === 204 ? null : await response.json()) };
    } catch {
      return { kind: 'refused', field: null, message: FAILED };
    }
  }
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = refusal.success ? refusal.data.error.code : null;
  const said = refusal.success ? `${refusal.data.error.message}.` : FAILED;
  if (code === CONTENT_REQUEST_DUE_UNPROCESSABLE) return { kind: 'refused', field: 'dueOn', message: said };
  if (code === CONTENT_REQUEST_STRUCTURE_UNPROCESSABLE)
    return { kind: 'refused', field: 'structureId', message: said };
  if (code === CONTENT_REQUEST_CLOSED_CONFLICT)
    return {
      kind: 'refused',
      field: null,
      message: 'Elle a déjà commencé ou déposé ce contenu : la demande ne s’annule plus.',
    };
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', field: null, message: FORBIDDEN };
  if (response.status === 400 || response.status === 422)
    return { kind: 'refused', field: null, message: said };
  return { kind: 'refused', field: null, message: FAILED };
}

/** Asks her for content; replayed under the same id, it answers the same request. */
export function askContent(
  creatorId: CreatorId,
  body: CreateContentRequestBody,
): Promise<Outcome<ContentRequest>> {
  return send(`/v1/creators/${creatorId}/content-requests`, 'POST', body, (json) =>
    ContentRequestSchema.parse(json),
  );
}

/** Cancels a request she has not begun. */
export function cancelRequest(creatorId: CreatorId, requestId: ContentRequestId): Promise<Outcome<null>> {
  return send(`/v1/creators/${creatorId}/content-requests/${requestId}`, 'DELETE', undefined, () => null);
}

/** Sets every how many days a script is asked of her (the owner's). */
export function setCadence(creatorId: CreatorId, days: number): Promise<Outcome<ScriptCadence>> {
  return send(`/v1/creators/${creatorId}/script-cadence`, 'PUT', { days }, (json) =>
    ScriptCadenceSchema.parse(json),
  );
}
