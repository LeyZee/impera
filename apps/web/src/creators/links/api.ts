import {
  AgencyRedirectLinkSchema,
  AgencyRedirectLinksResponseSchema,
  ApiErrorSchema,
  LinkProposalsResponseSchema,
  LinkServiceRefusalBodySchema,
  REAUTHENTICATION_ERROR_CODE,
  refusalOf,
  type AgencyRedirectLink,
  type AgencyRedirectLinkWrite,
  type LinkProposal,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:id/redirect-links` (INS-03, ADR 0121 § 1): her redirect links as the owner sets them and a manager reads them. Every answer
 * is parsed with the contract: a shape the screen does not expect reads as the server not answering.
 */

const UNAVAILABLE = 'Le serveur ne répond pas. Réessaie dans un instant.';

/** What the server says of a refused write, in the words of the screen. */
const REFUSALS: Readonly<Record<string, string>> = {
  redirect_link_name_conflict: 'Un autre lien porte déjà ce nom.',
  redirect_link_url_conflict: 'Cette adresse est déjà celle d’un autre lien.',
  redirect_links_full_conflict: 'Elle a déjà le nombre maximal de liens.',
  redirect_link_not_found: 'Ce lien n’existe plus : recharge la page.',
  redirect_link_forbidden: 'Tu ne peux pas régler les liens de cette créatrice.',
  redirect_link_unmatched_conflict: 'Aucun lien du service de redirection n’a cette adresse.',
  redirect_link_attached_conflict: 'Ce lien du service de redirection est déjà relié à un autre lien.',
};

const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/redirect-links`;

export const linksQueryKey = (creatorId: string): readonly string[] => ['redirect-links', creatorId];

async function fetchLinks(creatorId: string): Promise<readonly AgencyRedirectLink[]> {
  const response = await fetch(path(creatorId), { credentials: 'include' });
  if (!response.ok) throw new Error(`GET redirect-links: ${String(response.status)}`);
  return AgencyRedirectLinksResponseSchema.parse(await response.json()).links;
}

export function useRedirectLinks(creatorId: string): UseQueryResult<readonly AgencyRedirectLink[]> {
  // One retry, not three: « Le serveur ne répond pas » comes in under two seconds instead of a long skeleton.
  return useQuery({
    queryKey: linksQueryKey(creatorId),
    queryFn: () => fetchLinks(creatorId),
    retry: 1,
    retryDelay: 400,
  });
}

export type SaveOutcome =
  | { readonly kind: 'ok'; readonly link: AgencyRedirectLink }
  | { readonly kind: 'refused'; readonly message: string }
  /** The server wants the password and the code again before this write (ADR 0016). */
  | { readonly kind: 'reauth' };

/** Adds a link (`id` null) or corrects one; a refusal comes back as the sentence to show, never as a throw. */
export async function saveRedirectLink(
  creatorId: string,
  id: string | null,
  write: AgencyRedirectLinkWrite,
): Promise<SaveOutcome> {
  let response: Response;
  try {
    response = await fetch(id === null ? path(creatorId) : `${path(creatorId)}/${encodeURIComponent(id)}`, {
      method: id === null ? 'POST' : 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(write),
    });
  } catch {
    return { kind: 'refused', message: UNAVAILABLE };
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const link = AgencyRedirectLinkSchema.safeParse(body);
    return link.success ? { kind: 'ok', link: link.data } : { kind: 'refused', message: UNAVAILABLE };
  }
  const error = ApiErrorSchema.safeParse(body);
  if (error.success && error.data.error.code === REAUTHENTICATION_ERROR_CODE) return { kind: 'reauth' };
  if (response.status === 401) return { kind: 'refused', message: 'Ta session a expiré. Reconnecte-toi.' };
  if (response.status === 400)
    return { kind: 'refused', message: 'Une ligne ne passe pas : vérifie l’adresse et les textes.' };
  return {
    kind: 'refused',
    message: (error.success ? REFUSALS[error.data.error.code] : undefined) ?? UNAVAILABLE,
  };
}

export type DetectOutcome =
  | { readonly kind: 'ok'; readonly proposals: readonly LinkProposal[] }
  /** `needsKey`: no key of the redirect service yet, which Réglages › Plateformes settles. */
  | { readonly kind: 'refused'; readonly message: string; readonly needsKey: boolean };

/**
 * « Détecter ses liens » (INS-02): the links of the agency's account at the redirect service, each with a name and a
 * place proposed. Nothing is written by it: each link is added by the owner, one by one, with `saveRedirectLink`.
 */
export async function detectLinks(creatorId: string): Promise<DetectOutcome> {
  const refused = (message: string, needsKey = false): DetectOutcome => ({
    kind: 'refused',
    message,
    needsKey,
  });
  let response: Response;
  try {
    response = await fetch(`${path(creatorId)}/detect`, { method: 'POST', credentials: 'include' });
  } catch {
    return refused(UNAVAILABLE);
  }
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const answer = LinkProposalsResponseSchema.safeParse(body);
    return answer.success ? { kind: 'ok', proposals: answer.data.proposals } : refused(UNAVAILABLE);
  }
  if (response.status === 422) {
    const refusal = LinkServiceRefusalBodySchema.safeParse(body);
    if (!refusal.success) return refused(UNAVAILABLE);
    const { kind, message } = refusalOf(refusal.data);
    return refused(message, kind === 'not_connected' || kind === 'unauthorized');
  }
  if (response.status === 401) return refused('Ta session a expiré. Reconnecte-toi.');
  if (response.status === 429) return refused('Trop d’essais. Attends une minute avant de réessayer.');
  if (response.status === 403) return refused('Seul le propriétaire détecte les liens.');
  return refused(UNAVAILABLE);
}
