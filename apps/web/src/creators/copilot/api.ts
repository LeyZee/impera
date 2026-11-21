import { CopilotSwitchesSchema, type CopilotSwitches } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:id/copilot` (ADR 0086 § 6), the owner's alone: her two switches of the extension's copilot panel.
 * Neither changes the agent's mode nor sends anything, so no second sign-in. Every answer is parsed with the contract:
 * a shape the page does not expect reads as « Le serveur ne répond pas », never as a guess.
 */

export type CopilotErrorKind = 'session_expired' | 'forbidden' | 'not_found' | 'unavailable';

export const COPILOT_ERRORS: Readonly<Record<CopilotErrorKind, string>> = {
  session_expired: 'Ta session a expiré. Reconnecte-toi.',
  forbidden: 'Seul le compte propriétaire règle le copilote d’une créatrice.',
  not_found: 'Cette créatrice n’existe plus.',
  unavailable: 'Le serveur ne répond pas. Réessaie dans un instant.',
};

export class CopilotError extends Error {
  readonly kind: CopilotErrorKind;

  constructor(kind: CopilotErrorKind, detail: string) {
    super(`${COPILOT_ERRORS[kind]} (${detail})`);
    this.name = 'CopilotError';
    this.kind = kind;
  }
}

/** The sentence of a failed call; anything that is not a `CopilotError` is the server not answering. */
export const copilotErrorKind = (error: unknown): CopilotErrorKind =>
  error instanceof CopilotError ? error.kind : 'unavailable';

const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/copilot`;

async function call(creatorId: string, init: RequestInit = {}): Promise<CopilotSwitches> {
  const what = `${init.method ?? 'GET'} copilot`;
  let response: Response;
  try {
    response = await fetch(path(creatorId), { credentials: 'include', ...init });
  } catch {
    throw new CopilotError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  if (response.ok) {
    const switches = CopilotSwitchesSchema.safeParse(await response.json().catch(() => null));
    if (switches.success) return switches.data;
    throw new CopilotError('unavailable', `${detail}, réponse inattendue`);
  }
  if (response.status === 401) throw new CopilotError('session_expired', detail);
  if (response.status === 403) throw new CopilotError('forbidden', detail);
  if (response.status === 404) throw new CopilotError('not_found', detail);
  throw new CopilotError('unavailable', detail);
}

export const copilotQueryKey = (creatorId: string): readonly string[] => ['creator-copilot', creatorId];

export function useCopilotSwitches(creatorId: string): UseQueryResult<CopilotSwitches> {
  return useQuery({
    queryKey: copilotQueryKey(creatorId),
    queryFn: () => call(creatorId),
    retry: 1,
    retryDelay: 400,
  });
}

/** Turns one switch on or off; the other keeps its value. Answers with both, as the panel now reads them. */
export const saveCopilotSwitch = (
  creatorId: string,
  change: { readonly fanCard: boolean } | { readonly drafts: boolean },
): Promise<CopilotSwitches> =>
  call(creatorId, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change),
  });
