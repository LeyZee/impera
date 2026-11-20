import {
  ApiErrorSchema,
  PlatformScriptListSchema,
  PlatformScriptViewSchema,
  type CreatorId,
  type MediaDescriptionId,
  type PlatformScriptId,
  type PlatformScriptViewDto,
  type ScriptIdentityContent,
  type ScriptIdentityId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * « Ses scripts dans Reveal » (ADR 0099 § 4, SC-04 lot c8): her native scripts as the agency reads them, and the
 * reviews that make one proposable, its media's descriptions then its identity. Every answer is parsed with the
 * contract.
 */

export const revealScriptsKey = (creatorId: CreatorId) =>
  ['creators', creatorId, 'platform-scripts'] as const;

const scriptsUrl = (creatorId: CreatorId) => `/v1/creators/${creatorId}/platform-scripts`;

/** While the AI writes an identity (seconds, under the day's cap), the list is read again until it is there. */
const WRITING_POLL_MS = 8_000;

export function useRevealScripts(creatorId: CreatorId): UseQueryResult<readonly PlatformScriptViewDto[]> {
  return useQuery({
    queryKey: revealScriptsKey(creatorId),
    refetchInterval: (query) =>
      (query.state.data ?? []).some(
        (script) =>
          script.active && script.identity === null && script.gaps.join() === 'identity_not_validated',
      )
        ? WRITING_POLL_MS
        : false,
    queryFn: async () => {
      const response = await fetch(scriptsUrl(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET platform-scripts: ${String(response.status)}`);
      return PlatformScriptListSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type RevealOutcome =
  | { readonly kind: 'ok'; readonly script: PlatformScriptViewDto }
  | { readonly kind: 'refused'; readonly message: string };

export const REVEAL_ERRORS = {
  forbidden: 'Seuls le propriétaire et un manager de sa liste valident ses scripts.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
} as const;

/** The refusal's sentence (a newer description, one to read alone, a version changed) is said as it is. */
async function post(url: string, body: object): Promise<RevealOutcome> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'refused', message: REVEAL_ERRORS.failed };
  }
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const script = PlatformScriptViewSchema.safeParse(json);
    return script.success
      ? { kind: 'ok', script: script.data }
      : { kind: 'refused', message: REVEAL_ERRORS.failed };
  }
  const refusal = ApiErrorSchema.safeParse(json);
  if (response.status === 409 && refusal.success)
    return { kind: 'refused', message: `${refusal.data.error.message}.` };
  if (response.status === 403 || response.status === 404)
    return { kind: 'refused', message: REVEAL_ERRORS.forbidden };
  return { kind: 'refused', message: REVEAL_ERRORS.failed };
}

export const validateScriptDescriptions = (
  creatorId: CreatorId,
  scriptId: PlatformScriptId,
  descriptionIds: readonly MediaDescriptionId[],
): Promise<RevealOutcome> =>
  post(`${scriptsUrl(creatorId)}/${scriptId}/descriptions/validate`, { descriptionIds });

export const correctScriptDescription = (
  creatorId: CreatorId,
  scriptId: PlatformScriptId,
  descriptionId: MediaDescriptionId,
  detailed: string,
): Promise<RevealOutcome> =>
  post(`${scriptsUrl(creatorId)}/${scriptId}/descriptions/correct`, { descriptionId, detailed });

export const validateScriptIdentity = (
  creatorId: CreatorId,
  scriptId: PlatformScriptId,
  identityId: ScriptIdentityId,
): Promise<RevealOutcome> => post(`${scriptsUrl(creatorId)}/${scriptId}/identity/validate`, { identityId });

/** An identity written by hand over the one shown: validated as it is written. */
export const correctScriptIdentity = (
  creatorId: CreatorId,
  scriptId: PlatformScriptId,
  content: ScriptIdentityContent,
): Promise<RevealOutcome> => post(`${scriptsUrl(creatorId)}/${scriptId}/identity/correct`, { content });
