import { DraftCorrectionsViewSchema, type DraftCorrectionsView } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/** A refusal of the server: the page says it once, and does not ask again until she is chosen again. */
class CorrectionsRefused extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`GET draft-corrections: ${String(status)}`);
    this.name = 'CorrectionsRefused';
    this.status = status;
  }
}

/** `GET /v1/creators/:creatorId/draft-corrections` (trou béant 12), parsed with the contract. */
async function fetchDraftCorrections(creatorId: string): Promise<DraftCorrectionsView> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/draft-corrections`, {
    credentials: 'include',
  });
  if (!response.ok) throw new CorrectionsRefused(response.status);
  return DraftCorrectionsViewSchema.parse(await response.json());
}

export function useDraftCorrections(creatorId: string): UseQueryResult<DraftCorrectionsView> {
  return useQuery({
    queryKey: ['draft-corrections', creatorId],
    queryFn: () => fetchDraftCorrections(creatorId),
    enabled: creatorId !== '',
    retry: (failures, error) => !(error instanceof CorrectionsRefused) && failures < 2,
  });
}

/** What the page says when the list does not come. */
/** Why the corrections did not read, said in the app's own failure: a refusal named, the server's silence otherwise. */
export function correctionsError(error: unknown): { readonly title: string; readonly line: string } | null {
  if (error instanceof CorrectionsRefused) {
    if (error.status === 401) return { title: 'Ta session a expiré', line: 'Reconnecte-toi.' };
    if (error.status === 403)
      return { title: 'Réservé au propriétaire', line: 'Seul le compte propriétaire lit les corrections.' };
  }
  return null;
}
