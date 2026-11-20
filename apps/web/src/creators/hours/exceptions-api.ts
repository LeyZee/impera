import {
  AgentHourExceptionsViewSchema,
  ApiErrorSchema,
  REAUTHENTICATION_ERROR_CODE,
  type AgentHourExceptionsView,
  type DayRange,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { HoursError } from './api';

import { ReauthRequired } from '@/settings/services/api';

/**
 * `/v1/creators/:id/agent-hours/exceptions` (ADR 0148 § 3), the owner's alone: her dated days. A change asks for a
 * sign-in under 10 minutes (`ReauthRequired`); a date already past is refused (409, `refused`).
 */

const path = (creatorId: string, date?: string): string =>
  `/v1/creators/${encodeURIComponent(creatorId)}/agent-hours/exceptions${date === undefined ? '' : `/${date}`}`;

async function call(url: string, init: RequestInit = {}): Promise<AgentHourExceptionsView> {
  const what = `${init.method ?? 'GET'} agent-hours/exceptions`;
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', ...init });
  } catch {
    throw new HoursError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.ok) {
    const view = AgentHourExceptionsViewSchema.safeParse(await response.json().catch(() => null));
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
  if (response.status === 400 || response.status === 409) throw new HoursError('refused', detail);
  throw new HoursError('unavailable', detail);
}

export const exceptionsQueryKey = (creatorId: string): readonly string[] => [
  'agent-hours',
  creatorId,
  'exceptions',
];

export function useAgentHourExceptions(creatorId: string): UseQueryResult<AgentHourExceptionsView> {
  return useQuery({
    queryKey: exceptionsQueryKey(creatorId),
    queryFn: () => call(path(creatorId)),
    retry: 1,
    retryDelay: 400,
  });
}

/** Her ranges on that date, replacing her week's; none is « pas d'IA ce jour-là ». */
export const saveException = (
  creatorId: string,
  date: string,
  ranges: readonly DayRange[],
): Promise<AgentHourExceptionsView> =>
  call(path(creatorId, date), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ranges }),
  });

/** « Rétablir »: the date follows her week again. */
export const removeException = (creatorId: string, date: string): Promise<AgentHourExceptionsView> =>
  call(path(creatorId, date), { method: 'DELETE' });
