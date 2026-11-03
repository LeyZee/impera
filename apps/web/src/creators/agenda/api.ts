import {
  AgencySuggestionListSchema,
  AgencySuggestionSchema,
  ApiErrorSchema,
  SUGGESTION_DECLINED_RECENTLY_CONFLICT,
  SUGGESTION_ID_CONFLICT,
  type AgencySuggestion,
  type AgencySuggestionList,
  type CreateSuggestionBody,
  type CreatorId,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `/v1/creators/:creatorId/suggestions` (CR-05 lot c), the owner's and an active manager's. Every answer is parsed
 * with the contract: a shape the page does not expect reads as « Le serveur ne répond pas », never as a guess.
 */

export const suggestionsKey = (creatorId: CreatorId, week: string) =>
  ['creators', creatorId, 'suggestions', week] as const;

/** Her suggestions of the week that starts on `week` (her Monday). */
export function useAgencySuggestions(
  creatorId: CreatorId,
  week: string,
): UseQueryResult<AgencySuggestionList> {
  return useQuery({
    queryKey: suggestionsKey(creatorId, week),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/suggestions?week=${week}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`GET suggestions: ${String(response.status)}`);
      return AgencySuggestionListSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type SuggestOutcome =
  | { readonly kind: 'ok'; readonly suggestion: AgencySuggestion }
  /** 409: she declined this task this week or the week before. */
  | { readonly kind: 'declined_recently' }
  /** 409: the form's id already made another suggestion. */
  | { readonly kind: 'taken' }
  /** 403: not the owner nor an active manager of hers. */
  | { readonly kind: 'forbidden' }
  /** Any other refusal: what was typed is not taken as it is. */
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed' };

export const SUGGEST_ERRORS: Readonly<Record<Exclude<SuggestOutcome['kind'], 'ok'>, string>> = {
  declined_recently:
    'Elle a refusé cette tâche cette semaine ou la semaine dernière : on ne la lui repropose pas tout de suite.',
  taken: 'Cette proposition vient d’être envoyée avec d’autres valeurs. Ferme et recommence.',
  forbidden: 'Seuls le propriétaire et un manager actif proposent une tâche à une créatrice.',
  refused: 'Cette proposition ne passe pas. Vérifie le jour et les heures : 24 heures au plus.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a été envoyé.',
};

/** `POST /v1/creators/:creatorId/suggestions`: a suggestion for her agenda. */
export async function suggestTask(creatorId: CreatorId, body: CreateSuggestionBody): Promise<SuggestOutcome> {
  try {
    const response = await fetch(`/v1/creators/${creatorId}/suggestions`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', suggestion: AgencySuggestionSchema.parse(await response.json()) };
    if (response.status === 403) return { kind: 'forbidden' };
    const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    const code = refusal.success ? refusal.data.error.code : null;
    if (code === SUGGESTION_DECLINED_RECENTLY_CONFLICT) return { kind: 'declined_recently' };
    if (code === SUGGESTION_ID_CONFLICT) return { kind: 'taken' };
    return response.status >= 500 ? { kind: 'failed' } : { kind: 'refused' };
  } catch {
    return { kind: 'failed' };
  }
}
