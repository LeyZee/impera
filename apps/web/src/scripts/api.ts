import {
  ApiErrorSchema,
  ScriptQueueRefusalsSchema,
  ScriptQueueSchema,
  ScriptQueueUnprocessableSchema,
  ScriptStarterListSchema,
  ScriptStructureListSchema,
  ScriptStructureSchema,
  type CreatorId,
  type ScriptCardPreviewBody,
  type ScriptQueue,
  type ScriptQueueRefusals,
  type ScriptStarter,
  type ScriptStructure,
  type ScriptStructureBody,
  type ScriptStructureId,
} from '@impera/contracts';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

/** The workshop's calls (SC-01 lot c): the library, the starters, a save, a card's preview. */

export const structuresKey = ['script-structures'] as const;

async function read<T>(path: string, parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET ${path}: ${String(response.status)}`);
  return parse(await response.json());
}

export const structuresQuery = queryOptions({
  queryKey: structuresKey,
  queryFn: () => read('/v1/script-structures', (body) => ScriptStructureListSchema.parse(body).structures),
  retry: 1,
});

export function useStructures(): UseQueryResult<ScriptStructure[]> {
  return useQuery(structuresQuery);
}

export function useStarters(): UseQueryResult<ScriptStarter[]> {
  return useQuery({
    queryKey: [...structuresKey, 'starters'],
    queryFn: () =>
      read('/v1/script-structures/starters', (body) => ScriptStarterListSchema.parse(body).starters),
    staleTime: Infinity,
    retry: 1,
  });
}

export type SaveResult =
  | { readonly kind: 'saved'; readonly structure: ScriptStructure }
  /** 400: a rule the screen did not see; the server's sentence. */
  | { readonly kind: 'invalid'; readonly message: string }
  /** 409 on a change: another version was written since this one was read. */
  | { readonly kind: 'stale' }
  /** 409 on a creation: this id already holds another structure. */
  | { readonly kind: 'conflict' }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/**
 * A structure written: `POST` under the client's id when it is new (`basedOnVersion` null), `PUT` over the version read
 * otherwise. The same `POST` sent again answers what it stored.
 */
export async function saveStructure(
  id: ScriptStructureId,
  body: ScriptStructureBody,
  basedOnVersion: number | null,
): Promise<SaveResult> {
  let response: Response;
  try {
    response = await fetch(
      basedOnVersion === null ? '/v1/script-structures' : `/v1/script-structures/${encodeURIComponent(id)}`,
      {
        method: basedOnVersion === null ? 'POST' : 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(basedOnVersion === null ? { ...body, id } : { ...body, basedOnVersion }),
      },
    );
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) {
    const structure = ScriptStructureSchema.safeParse(await response.json().catch(() => null));
    return structure.success ? { kind: 'saved', structure: structure.data } : { kind: 'failed' };
  }
  if (response.status === 401) return { kind: 'expired' };
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (response.status === 409) {
    return error.data?.error.code === 'script_structure_stale_conflict'
      ? { kind: 'stale' }
      : { kind: 'conflict' };
  }
  if (response.status === 400) {
    return { kind: 'invalid', message: error.data?.error.message ?? 'La structure n’est pas acceptée' };
  }
  return { kind: 'failed' };
}

/**
 * The card of a draft's segment, as the server draws it, or `null` when it cannot (a field still empty, the server
 * away). An SVG text, shown through an `<img>` only: never put in the page, so nothing in it runs.
 */
export async function previewCard(body: ScriptCardPreviewBody, signal: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch('/v1/script-structures/cards/preview', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export const queueKey = (creatorId: CreatorId): readonly unknown[] => [...structuresKey, 'queue', creatorId];

/** Her queue as the server reads it today, each entry with what blocks it. */
export function useQueue(creatorId: CreatorId): UseQueryResult<ScriptQueue> {
  return useQuery({
    queryKey: queueKey(creatorId),
    queryFn: () =>
      read(`/v1/creators/${encodeURIComponent(creatorId)}/script-queue`, (body) =>
        ScriptQueueSchema.parse(body),
      ),
    retry: 1,
  });
}

export type QueueSaveResult =
  | { readonly kind: 'saved'; readonly queue: ScriptQueue }
  /** A stage of these structures touches her limits: nothing written. */
  | { readonly kind: 'blocked'; readonly refusals: ScriptQueueRefusals['refusals'] }
  /** Unknown, archived, or kept for another creator: nothing written. */
  | { readonly kind: 'unprocessable'; readonly structureIds: readonly ScriptStructureId[] }
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/** Her whole queue, in order, replaces the one stored; the same list sent again answers the same. */
export async function saveQueue(
  creatorId: CreatorId,
  structureIds: readonly ScriptStructureId[],
): Promise<QueueSaveResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/script-queue`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ structureIds }),
    });
  } catch {
    return { kind: 'failed' };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const queue = ScriptQueueSchema.safeParse(body);
    return queue.success ? { kind: 'saved', queue: queue.data } : { kind: 'failed' };
  }
  if (response.status === 401) return { kind: 'expired' };
  const error = ApiErrorSchema.safeParse(body);
  if (error.data?.error.code === 'script_queue_disgust_unprocessable') {
    const details = ScriptQueueRefusalsSchema.safeParse(error.data.error.details);
    if (details.success) return { kind: 'blocked', refusals: details.data.refusals };
  }
  if (error.data?.error.code === 'script_queue_structure_unprocessable') {
    const details = ScriptQueueUnprocessableSchema.safeParse(error.data.error.details);
    if (details.success) return { kind: 'unprocessable', structureIds: details.data.structureIds };
  }
  return { kind: 'failed' };
}
