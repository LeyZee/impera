import {
  CreatorAlertLineSchema,
  CreatorAlertsViewSchema,
  type CreatorAlertCode,
  type CreatorAlertLine,
  type CreatorAlertRouting,
  type CreatorAlertsView,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:id/alerts` (ADR 0150), the owner's alone. Every answer is parsed with the contract: a shape the page
 * does not expect reads as « Le serveur ne répond pas ».
 */

export type AlertsErrorKind = 'session_expired' | 'forbidden' | 'not_found' | 'rejected' | 'unavailable';

export const ALERTS_ERRORS: Readonly<Record<AlertsErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Seul le compte propriétaire règle les alertes d’une créatrice.',
  not_found: 'Cette créatrice n’existe plus.',
  rejected: 'Le serveur a refusé ce réglage. Recharge la page.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class AlertsError extends Error {
  readonly kind: AlertsErrorKind;

  constructor(kind: AlertsErrorKind, detail: string) {
    super(`${ALERTS_ERRORS[kind]} (${detail})`);
    this.name = 'AlertsError';
    this.kind = kind;
  }
}

export const alertsErrorKind = (error: unknown): AlertsErrorKind =>
  error instanceof AlertsError ? error.kind : 'unavailable';

const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/alerts`;

async function call(url: string, what: string, init: RequestInit = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', ...init });
  } catch {
    throw new AlertsError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) return body;
  if (response.status === 401) throw new AlertsError('session_expired', detail);
  if (response.status === 403) throw new AlertsError('forbidden', detail);
  if (response.status === 404) throw new AlertsError('not_found', detail);
  if (response.status === 400 || response.status === 422) throw new AlertsError('rejected', detail);
  throw new AlertsError('unavailable', detail);
}

export const alertsQueryKey = (creatorId: string): readonly string[] => ['creator-alerts', creatorId];

export function useCreatorAlerts(creatorId: string): UseQueryResult<CreatorAlertsView> {
  return useQuery({
    queryKey: alertsQueryKey(creatorId),
    queryFn: async () => {
      const view = CreatorAlertsViewSchema.safeParse(await call(path(creatorId), 'GET alerts'));
      if (view.success) return view.data;
      throw new AlertsError('unavailable', 'GET alerts: réponse inattendue');
    },
    retry: 1,
    retryDelay: 400,
  });
}

/** Stores one alert's three roles; answers with the line the server now holds. */
export async function saveCreatorAlert(
  creatorId: string,
  code: CreatorAlertCode,
  routes: CreatorAlertRouting,
): Promise<CreatorAlertLine> {
  const body = await call(`${path(creatorId)}/${code}`, 'PUT alerts', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ routes }),
  });
  const line = CreatorAlertLineSchema.safeParse(body);
  if (line.success) return line.data;
  throw new AlertsError('unavailable', 'PUT alerts: réponse inattendue');
}
