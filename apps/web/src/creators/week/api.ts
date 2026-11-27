import {
  AgencyCreatorWeekSchema,
  ApiErrorSchema,
  CREATOR_WEEK_PLAN_UNPROCESSABLE,
  CREATOR_WEEK_VALIDATED_CONFLICT,
  type AgencyCreatorWeek,
  type CreatorId,
  type WeekPlan,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/*
 * `/v1/creators/:creatorId/weeks/:week` (ADR 0140), the owner's (an active manager reads): the week the code proposed,
 * and its validation. Every answer is parsed with the contract.
 */

export const creatorWeekKey = (creatorId: CreatorId, week: string) =>
  ['creators', creatorId, 'week', week] as const;

/** Her week starting on `week`; `null` while it is not computed yet. */
export function useAgencyCreatorWeek(
  creatorId: CreatorId,
  week: string,
): UseQueryResult<AgencyCreatorWeek | null> {
  return useQuery({
    queryKey: creatorWeekKey(creatorId, week),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/weeks/${week}`, { credentials: 'include' });
      // 204 while it is not computed yet: an ordinary state (MAN-08, DS-14).
      if (response.status === 204) return null;
      if (!response.ok) throw new Error(`GET week: ${String(response.status)}`);
      return AgencyCreatorWeekSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type ValidateOutcome =
  | { readonly kind: 'ok'; readonly week: AgencyCreatorWeek }
  /** 409: validated meanwhile with another plan. */
  | { readonly kind: 'validated' }
  /** 422: a shooting day outside the week. */
  | { readonly kind: 'invalid' }
  /** 403: only the owner validates. */
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

export const VALIDATE_ERRORS: Readonly<Record<Exclude<ValidateOutcome['kind'], 'ok'>, string>> = {
  validated: 'Cette semaine a déjà été validée autrement. Elle est relue telle qu’elle est partie.',
  invalid: 'Un jour de tournage tombe hors de la semaine. Vérifie les jours : rien n’a été envoyé.',
  forbidden: 'Seul le propriétaire valide la semaine d’une créatrice.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a été envoyé.',
};

/** `POST …/validate`: the week as the owner corrected it goes to her agenda. */
export async function validateCreatorWeek(
  creatorId: CreatorId,
  week: string,
  plan: WeekPlan,
): Promise<ValidateOutcome> {
  try {
    const response = await fetch(`/v1/creators/${creatorId}/weeks/${week}/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    if (response.ok) return { kind: 'ok', week: AgencyCreatorWeekSchema.parse(await response.json()) };
    if (response.status === 403) return { kind: 'forbidden' };
    const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    const code = refusal.success ? refusal.data.error.code : null;
    if (code === CREATOR_WEEK_VALIDATED_CONFLICT) return { kind: 'validated' };
    if (code === CREATOR_WEEK_PLAN_UNPROCESSABLE) return { kind: 'invalid' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
