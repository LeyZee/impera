import {
  ALERT_HISTORY_ERROR_CODES,
  AlertTriggerItemSchema,
  ApiErrorSchema,
  MarkAlertTriggersSeenResultSchema,
  pageOf,
  type AlertHistoryErrorCode,
  type MarkAlertTriggersSeenBody,
} from '@nirvana/contracts';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import type { AlertChoice, CreatorTriggers } from './model';

/**
 * `/v1/alerts/triggers` (P4-01): the history of one creator's alerts and the agency's « vu ». Read for whoever sees the
 * whole creator, the owner or an operator; every answer is parsed with the contract.
 */

/** Why a call failed, as the page says it. */
export type HistoryErrorKind = 'session_expired' | 'forbidden' | 'gone' | 'unavailable';

export const HISTORY_ERRORS: Readonly<Record<HistoryErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'L’historique des alertes se lit par le propriétaire et l’équipe qui suit toute la créatrice.',
  gone: 'Cette alerte n’est plus dans l’historique : la liste est relue.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class HistoryError extends Error {
  readonly kind: HistoryErrorKind;

  constructor(kind: HistoryErrorKind, detail: string) {
    super(`${HISTORY_ERRORS[kind]} (${detail})`);
    this.name = 'HistoryError';
    this.kind = kind;
  }
}

export const historyErrorKind = (error: unknown): HistoryErrorKind =>
  error instanceof HistoryError ? error.kind : 'unavailable';

/** Every code of the contract has its sentence: a code added on the server breaks the typecheck here. */
const KIND_OF_CODE: Readonly<Record<AlertHistoryErrorCode, HistoryErrorKind>> = {
  alert_trigger_not_found: 'gone',
  // A cursor is one of the list's own triggers, never edited: one refused is the server's fault, read again.
  cursor_invalid: 'unavailable',
};

async function call<T>(
  path: string,
  parse: (body: unknown) => { success: true; data: T } | { success: false },
  init: RequestInit = {},
): Promise<T> {
  const what = `${init.method ?? 'GET'} ${path.split('?')[0] ?? path}`;
  let response: Response;
  try {
    response = await fetch(path, {
      credentials: 'include',
      ...init,
      ...(init.body === undefined ? {} : { headers: { 'content-type': 'application/json' } }),
    });
  } catch {
    throw new HistoryError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.ok) {
    const parsed = parse(response.status === 204 ? null : await response.json().catch(() => null));
    if (parsed.success) return parsed.data;
    throw new HistoryError('unavailable', `${detail}, réponse inattendue`);
  }
  if (response.status === 401) throw new HistoryError('session_expired', detail);
  if (response.status === 403) throw new HistoryError('forbidden', detail);
  const body = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = body.success ? body.data.error.code : null;
  const known = ALERT_HISTORY_ERROR_CODES.find((one) => one === code);
  if (known !== undefined) throw new HistoryError(KIND_OF_CODE[known], detail);
  if (response.status === 404) throw new HistoryError('gone', detail);
  throw new HistoryError('unavailable', detail);
}

const PageSchema = pageOf(AlertTriggerItemSchema);

/** A page as the list reads it: enough for a screen, and « Voir plus » reads the next. */
export const HISTORY_PAGE = 50;

export interface HistoryFilter {
  /** `true`: the lines nobody of the agency marked seen. */
  readonly unseen: boolean;
  readonly alert: AlertChoice | null;
}

/**
 * One creator's first `pages` pages, read in a row from the newest: read again whole, the list is one moment of the
 * history, never pages of two moments stitched.
 */
export async function fetchTriggers(
  creatorId: string,
  filter: HistoryFilter,
  pages: number,
): Promise<CreatorTriggers> {
  const items: CreatorTriggers['items'][number][] = [];
  let cursor: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    const query = new URLSearchParams({ creatorId, limit: String(HISTORY_PAGE) });
    if (filter.unseen) query.set('seen', 'false');
    if (filter.alert !== null) query.set('alert', filter.alert);
    if (cursor !== null) query.set('cursor', cursor);
    const read = await call(`/v1/alerts/triggers?${query.toString()}`, (body) => PageSchema.safeParse(body));
    items.push(...read.items);
    cursor = read.nextCursor;
    if (cursor === null) break;
  }
  return { creatorId, items, nextCursor: cursor };
}

export const HISTORY_KEY = ['alert-history'] as const;
const REFRESH_MS = 30_000;

/** What the page reads of every creator's history: `pending` until each is read once. */
export interface HistoryRead {
  readonly lists: readonly CreatorTriggers[];
  readonly pending: boolean;
  /** What is shown is the previous filter's or depth's, while the new read comes. */
  readonly stale: boolean;
  readonly error: unknown;
  /** Reads again the creators whose read failed. */
  readonly refetch: () => void;
}

/**
 * The history of each creator, under the same filter and depth. « Voir plus » and a filter keep the last lines read in
 * place, marked `stale`, while the new read comes: under `useQueries` a new key is a new observer, so `placeholderData`
 * would have no previous data to give.
 */
export function useHistory(creatorIds: readonly string[], filter: HistoryFilter, pages: number): HistoryRead {
  const read = useQueries({
    queries: creatorIds.map((creatorId) => ({
      queryKey: [...HISTORY_KEY, creatorId, filter.unseen, filter.alert, pages],
      queryFn: () => fetchTriggers(creatorId, filter, pages),
      refetchInterval: REFRESH_MS,
    })),
    combine: combineHistory,
  });
  const [shown, setShown] = useState<readonly CreatorTriggers[] | null>(null);
  // A read over no creator (hers not loaded yet) is no history: kept, it would show « no alert yet » until the first
  // real read answers, or for good while the server fails. Until then the page shows its skeleton.
  const hasScope = creatorIds.length > 0;
  useEffect(() => {
    if (!read.pending && hasScope) setShown(read.lists);
  }, [read.pending, read.lists, hasScope]);
  if (!read.pending || shown === null) return read;
  return { ...read, lists: shown, pending: false, stale: true };
}

function combineHistory(
  results: readonly {
    readonly data: CreatorTriggers | undefined;
    readonly isPending: boolean;
    readonly error: unknown;
    readonly refetch: () => Promise<unknown>;
  }[],
): Omit<HistoryRead, 'stale'> & { readonly stale: false } {
  return {
    lists: results.flatMap((result) => (result.data === undefined ? [] : [result.data])),
    pending: results.some((result) => result.isPending),
    stale: false,
    error: results.find((result) => result.error !== null)?.error ?? null,
    refetch: () => {
      for (const result of results) if (result.error !== null) void result.refetch();
    },
  };
}

/** `POST /v1/alerts/triggers/:id/seen`: seen for the whole agency; again is the same. */
export const markSeen = (creatorId: string, triggerId: string): Promise<null> =>
  call(
    `/v1/alerts/triggers/${encodeURIComponent(triggerId)}/seen?${new URLSearchParams({ creatorId }).toString()}`,
    () => ({ success: true, data: null }),
    { method: 'POST' },
  );

/** `POST /v1/alerts/triggers/seen`: every trigger of hers up to `untilId`, that one included, under the list's filter. */
export const markAllSeen = (body: MarkAlertTriggersSeenBody): Promise<number> =>
  call(
    '/v1/alerts/triggers/seen',
    (answer) => {
      const parsed = MarkAlertTriggersSeenResultSchema.safeParse(answer);
      return parsed.success ? { success: true, data: parsed.data.marked } : { success: false };
    },
    { method: 'POST', body: JSON.stringify(body) },
  );

/** After a « vu »: the history is read again, every creator and filter. */
export function useRefreshHistory(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(() => client.invalidateQueries({ queryKey: HISTORY_KEY }), [client]);
}
