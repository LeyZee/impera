import {
  ALERT_ERROR_CODES,
  AlertTestResultSchema,
  AlertsViewSchema,
  ApiErrorSchema,
  CustomAlertGroupSchema,
  SystemAlertSettingSchema,
  type AlertErrorCode,
  type AlertTestBody,
  type AlertTestResult,
  type AlertsView,
  type CreateCustomAlertBody,
  type CustomAlertBody,
  type CustomAlertGroup,
  type CustomAlertGroupId,
  type SetSystemAlertBody,
  type SystemAlertCode,
  type SystemAlertSetting,
} from '@nirvana/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/alerts` (P4-01), the owner's alone. Every answer is parsed with the contract: a shape the page does not
 * expect reads as « Le serveur ne répond pas », never as a guess. A new alert carries an id made here, so that a
 * retry after a lost answer writes it once.
 */

/** Why a call failed, as the page says it. */
export type AlertsErrorKind =
  | 'session_expired'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'name_taken'
  | 'creator_invalid'
  | 'locked'
  | 'refused'
  | 'unavailable';

export const ALERTS_ERRORS: Readonly<Record<AlertsErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Seul le compte propriétaire règle les alertes.',
  not_found: 'Cette alerte n’existe plus : quelqu’un l’a archivée entre-temps.',
  conflict: 'Cette alerte a déjà été créée autrement. Recharge la page.',
  name_taken: 'Une alerte active porte déjà ce nom.',
  creator_invalid: 'Une des créatrices choisies n’existe plus. Recharge la page.',
  locked: 'Les mots-clés de la persona restent toujours actifs : un mot se retire dans sa persona.',
  refused: 'Cette alerte ne passe pas : un champ est à corriger.',
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

/** The sentence of a failed call; anything that is not an `AlertsError` is the server not answering. */
export const alertsErrorKind = (error: unknown): AlertsErrorKind =>
  error instanceof AlertsError ? error.kind : 'unavailable';

/** Every code of the contract has its sentence: a code added on the server breaks the typecheck here. */
const KIND_OF_CODE: Readonly<Record<AlertErrorCode, AlertsErrorKind>> = {
  custom_alert_not_found: 'not_found',
  custom_alert_conflict: 'conflict',
  custom_alert_name_conflict: 'name_taken',
  alert_creator_invalid: 'creator_invalid',
  system_alert_locked_unprocessable: 'locked',
};

async function call<T>(
  path: string,
  parse: (body: unknown) => { success: true; data: T } | { success: false },
  init: RequestInit = {},
): Promise<T> {
  const what = `${init.method ?? 'GET'} ${path}`;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...init,
      ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' } }),
    });
  } catch {
    throw new AlertsError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.ok) {
    const parsed = parse(response.status === 204 ? null : await response.json().catch(() => null));
    if (parsed.success) return parsed.data;
    throw new AlertsError('unavailable', `${detail}, réponse inattendue`);
  }
  if (response.status === 401) throw new AlertsError('session_expired', detail);
  if (response.status === 403) throw new AlertsError('forbidden', detail);
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = body.success ? body.data.error.code : null;
  const known = ALERT_ERROR_CODES.find((one) => one === code);
  if (known !== undefined) throw new AlertsError(KIND_OF_CODE[known], detail);
  if (response.status === 404) throw new AlertsError('not_found', detail);
  if (response.status === 400 || response.status === 422) throw new AlertsError('refused', detail);
  throw new AlertsError('unavailable', detail);
}

const json = (body: unknown): Pick<RequestInit, 'body'> => ({ body: JSON.stringify(body) });
const group = (id: CustomAlertGroupId): string => `/v1/alerts/${encodeURIComponent(id)}`;

export const ALERTS_QUERY_KEY = ['alerts'] as const;

export const fetchAlerts = (): Promise<AlertsView> =>
  call('/v1/alerts', (body) => AlertsViewSchema.safeParse(body));

/** `enabled: false` for anyone but the owner, whom the route answers alone. */
export function useAlerts({
  enabled = true,
}: { readonly enabled?: boolean } = {}): UseQueryResult<AlertsView> {
  return useQuery({ queryKey: ALERTS_QUERY_KEY, queryFn: fetchAlerts, enabled });
}

/** Writes a new alert on its creators; the same body sent again answers what is stored. */
export const createAlert = (body: CreateCustomAlertBody): Promise<CustomAlertGroup> =>
  call('/v1/alerts', (answer) => CustomAlertGroupSchema.safeParse(answer), { method: 'POST', ...json(body) });

/** Replaces the alert on all its creators: a creator left out is archived for her. */
export const replaceAlert = (id: CustomAlertGroupId, body: CustomAlertBody): Promise<CustomAlertGroup> =>
  call(group(id), (answer) => CustomAlertGroupSchema.safeParse(answer), { method: 'PUT', ...json(body) });

/** Archives the alert: it stops watching, and its past triggers stay in the history. */
export const archiveAlert = (id: CustomAlertGroupId): Promise<null> =>
  call(group(id), () => ({ success: true, data: null }), { method: 'DELETE' });

/** « Tester »: the alert as written, on an example message; nothing is stored, nothing is sent. */
export const testAlert = (body: AlertTestBody): Promise<AlertTestResult> =>
  call('/v1/alerts/test', (answer) => AlertTestResultSchema.safeParse(answer), {
    method: 'POST',
    ...json(body),
  });

export const setSystemAlert = (
  code: SystemAlertCode,
  body: SetSystemAlertBody,
): Promise<SystemAlertSetting> =>
  call(
    `/v1/alerts/system/${encodeURIComponent(code)}`,
    (answer) => SystemAlertSettingSchema.safeParse(answer),
    { method: 'PUT', ...json(body) },
  );
