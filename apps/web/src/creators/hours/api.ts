import {
  AgentHoursViewSchema,
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  type AgentHours,
  type AgentHoursView,
} from '@nirvana/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { ReauthRequired } from '@/settings/services/api';

/**
 * `/v1/creators/:id/agent-hours` (P3-14), the owner's alone. Every answer is parsed with the contract: a shape the
 * page does not expect reads as « Le serveur ne répond pas », never as a guess. A change asks for a sign-in under
 * 10 minutes (ADR 0016): `ReauthRequired`, then the page asks for the password and saves again.
 */

/** Why a call failed, as the page says it. */
export type HoursErrorKind = 'session_expired' | 'forbidden' | 'not_found' | 'refused' | 'unavailable';

export const HOURS_ERRORS: Readonly<Record<HoursErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Seul le compte propriétaire règle les heures de l’agent.',
  not_found: 'Cette créatrice n’existe plus.',
  refused: 'Ces heures ne passent pas : une ligne est à corriger.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class HoursError extends Error {
  readonly kind: HoursErrorKind;

  constructor(kind: HoursErrorKind, detail: string) {
    super(`${HOURS_ERRORS[kind]} (${detail})`);
    this.name = 'HoursError';
    this.kind = kind;
  }
}

/** The sentence of a failed call; anything that is not a `HoursError` is the server not answering. */
export const hoursErrorKind = (error: unknown): HoursErrorKind =>
  error instanceof HoursError ? error.kind : 'unavailable';

const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/agent-hours`;

async function call(creatorId: string, init: RequestInit = {}): Promise<AgentHoursView> {
  const what = `${init.method ?? 'GET'} agent-hours`;
  let response: Response;
  try {
    response = await fetch(path(creatorId), { credentials: 'include', ...init });
  } catch {
    throw new HoursError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.ok) {
    const view = AgentHoursViewSchema.safeParse(await response.json().catch(() => null));
    if (view.success) return view.data;
    throw new HoursError('unavailable', `${detail}, réponse inattendue`);
  }
  if (response.status === 401) throw new HoursError('session_expired', detail);
  if (response.status === 403) {
    const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    if (body.success && body.data.error.code === REAUTHENTICATION_ERROR_CODE) throw new ReauthRequired();
    throw new HoursError('forbidden', detail);
  }
  if (response.status === 404) throw new HoursError('not_found', detail);
  if (response.status === 400) throw new HoursError('refused', detail);
  throw new HoursError('unavailable', detail);
}

export const hoursQueryKey = (creatorId: string): readonly string[] => ['agent-hours', creatorId];

/** Her hours as the agent reads them, on her clock. */
export const fetchAgentHours = (creatorId: string): Promise<AgentHoursView> => call(creatorId);

export function useAgentHours(creatorId: string): UseQueryResult<AgentHoursView> {
  // One retry, not three: « Le serveur ne répond pas » comes in under two seconds instead of a long skeleton (CREA-30).
  return useQuery({
    queryKey: hoursQueryKey(creatorId),
    queryFn: () => fetchAgentHours(creatorId),
    retry: 1,
    retryDelay: 400,
  });
}

/** Stores her hours, `null` to follow the defaults; answers with what the agent now reads. */
export const saveAgentHours = (creatorId: string, hours: AgentHours | null): Promise<AgentHoursView> =>
  call(creatorId, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
