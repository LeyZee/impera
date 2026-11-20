import {
  ApiErrorSchema,
  PreparedScriptListSchema,
  PreparedScriptViewSchema,
  type CreatorId,
  type PlatformAccountId,
  type PreparedScriptContent,
  type PreparedScriptId,
  type PreparedScriptView,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * Créatrices › Scripts › Scripts (ADR 0112 §§ 20-22): her scripts in preparation, read and written by the owner and an
 * active manager of her list. Every answer is parsed with the contract; nothing is written at Reveal from here.
 */

export const preparedKey = (creatorId: CreatorId) => ['creators', creatorId, 'prepared-scripts'] as const;

const base = (creatorId: CreatorId): string => `/v1/creators/${creatorId}/prepared-scripts`;

export function usePreparedScripts(creatorId: CreatorId): UseQueryResult<readonly PreparedScriptView[]> {
  return useQuery({
    queryKey: preparedKey(creatorId),
    queryFn: async () => {
      const response = await fetch(base(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET prepared-scripts: ${String(response.status)}`);
      return PreparedScriptListSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type WriteOutcome =
  | { readonly kind: 'ok'; readonly view: PreparedScriptView }
  /** Saved by someone else since: the screen reads it again before anything else. */
  | { readonly kind: 'stale'; readonly message: string }
  | { readonly kind: 'refused'; readonly message: string };

export const WRITE_ERRORS = {
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
  forbidden: 'Seuls le propriétaire et un manager actif écrivent ses scripts.',
} as const;

async function write(url: string, method: 'POST' | 'PUT', body: unknown): Promise<WriteOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'refused', message: WRITE_ERRORS.failed };
  }
  if (response.ok) {
    const view = PreparedScriptViewSchema.safeParse(await response.json().catch(() => null));
    return view.success ? { kind: 'ok', view: view.data } : { kind: 'refused', message: WRITE_ERRORS.failed };
  }
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (refusal.success) {
    const { code, message } = refusal.data.error;
    if (code === 'prepared_script_stale_conflict') return { kind: 'stale', message: `${message}.` };
    if (code.startsWith('prepared_script_')) return { kind: 'refused', message: `${message}.` };
  }
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', message: WRITE_ERRORS.forbidden };
  return { kind: 'refused', message: WRITE_ERRORS.failed };
}

/** « Créer le brouillon », under the client's id: the same send replays. */
export const createPrepared = (
  creatorId: CreatorId,
  id: PreparedScriptId,
  platformAccountId: PlatformAccountId,
  content: PreparedScriptContent,
): Promise<WriteOutcome> => write(base(creatorId), 'POST', { id, platformAccountId, content });

/** A save on the revision read; a script « prêt à copier » goes back to editing. */
export const savePrepared = (
  creatorId: CreatorId,
  id: PreparedScriptId,
  basedOnRevision: number,
  content: PreparedScriptContent,
): Promise<WriteOutcome> => write(`${base(creatorId)}/${id}`, 'PUT', { basedOnRevision, content });

/** « Prêt à copier dans Reveal », or back to editing. */
export const changePreparedState = (
  creatorId: CreatorId,
  id: PreparedScriptId,
  basedOnRevision: number,
  to: 'ready' | 'editing',
): Promise<WriteOutcome> => write(`${base(creatorId)}/${id}/${to}`, 'POST', { basedOnRevision });
