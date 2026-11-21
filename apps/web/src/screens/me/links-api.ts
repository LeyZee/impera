import { CreatorLinksResponseSchema, type CreatorLinkCard } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creator-space/links` (INS-03, ADR 0121 § 1): her own links that are on and placed. The answer is parsed with
 * the contract: a shape the page does not expect reads as the server not answering, never as a guess.
 */
async function fetchMyLinks(): Promise<readonly CreatorLinkCard[]> {
  const response = await fetch('/v1/creator-space/links', { credentials: 'include' });
  if (!response.ok) throw new Error(`GET creator-space/links: ${String(response.status)}`);
  return CreatorLinksResponseSchema.parse(await response.json()).links;
}

export function useMyLinks(): UseQueryResult<readonly CreatorLinkCard[]> {
  // One retry, not three: « Le serveur ne répond pas » comes in under two seconds instead of a long skeleton.
  return useQuery({ queryKey: ['creator-space', 'links'], queryFn: fetchMyLinks, retry: 1, retryDelay: 400 });
}
