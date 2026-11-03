import {
  ApiErrorSchema,
  ScriptStarterListSchema,
  ScriptStructureListSchema,
  ScriptStructureSchema,
  type ScriptCardPreviewBody,
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
