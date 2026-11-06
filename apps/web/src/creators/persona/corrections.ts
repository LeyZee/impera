import {
  ApiErrorSchema,
  PersonaCorrectionListSchema,
  PersonaCorrectionSchema,
  type PersonaCorrection,
  type PersonaCorrectionErrorCode,
  type PersonaCorrectionId,
  type PersonaCorrectionSection,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/** Her corrections of her sheet (recette CREA-01 b): what she proposed from Moi › Persona, the agency handles them. */

/** The name of each section, as she reads it (Moi › Persona) and as the agency reads it on her persona. */
export const CORRECTION_SECTION_LABELS: Readonly<
  Record<PersonaCorrectionSection, { readonly hers: string; readonly agency: string }>
> = {
  details: { hers: 'Qui tu es', agency: 'Qui elle est' },
  limits: { hers: 'Tes limites', agency: 'Ses limites' },
  lifestyle: { hers: 'Ta vie', agency: 'Sa vie' },
  tastes: { hers: 'Tes goûts', agency: 'Ses goûts' },
  intimate: { hers: 'L’intime', agency: 'L’intime' },
  writing_style: { hers: 'Ta façon d’écrire', agency: 'Sa façon d’écrire' },
};

export const correctionsKey = (creatorId: string): readonly unknown[] => ['persona-corrections', creatorId];

/** `GET /v1/creators/:id/persona/corrections`: hers, newest first (to her, or to the owner and a manager). */
async function fetchCorrections(creatorId: string): Promise<PersonaCorrection[]> {
  const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona/corrections`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error(`GET persona/corrections: ${String(response.status)}`);
  return PersonaCorrectionListSchema.parse(await response.json()).corrections;
}

/** Her corrections; `enabled` false for a reader who has none to read (a chatter). */
export function useCorrections(
  creatorId: string | null,
  enabled = true,
): UseQueryResult<PersonaCorrection[]> {
  return useQuery({
    queryKey: correctionsKey(creatorId ?? ''),
    queryFn: () => fetchCorrections(creatorId ?? ''),
    enabled: enabled && creatorId !== null,
    retry: 1,
  });
}

export type ProposeResult =
  | { readonly kind: 'sent'; readonly correction: PersonaCorrection }
  /** 429: twenty already wait for the agency. */
  | { readonly kind: 'limited' }
  /** 401: the session ended. */
  | { readonly kind: 'expired' }
  | { readonly kind: 'failed' };

/**
 * `POST /v1/creators/:id/persona/corrections`, the creator only. `id` is chosen once per form: sent twice (double tap,
 * retry), the server answers the correction it already stored.
 */
export async function proposeCorrection(
  creatorId: string,
  id: PersonaCorrectionId,
  section: PersonaCorrectionSection,
  text: string,
): Promise<ProposeResult> {
  let response: Response;
  try {
    response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona/corrections`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, section, text }),
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.status === 201) {
    return { kind: 'sent', correction: PersonaCorrectionSchema.parse(await response.json()) };
  }
  if (response.status === 401) return { kind: 'expired' };
  const error = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return error.data?.error.code === ('persona_corrections_limited' satisfies PersonaCorrectionErrorCode)
    ? { kind: 'limited' }
    : { kind: 'failed' };
}

/** `POST …/persona/corrections/:id/done`, the owner only: answers it handled, or null when it did not go through. */
export async function markCorrectionDone(
  creatorId: string,
  correctionId: PersonaCorrectionId,
): Promise<PersonaCorrection | null> {
  try {
    const response = await fetch(
      `/v1/creators/${encodeURIComponent(creatorId)}/persona/corrections/${encodeURIComponent(correctionId)}/done`,
      { method: 'POST', credentials: 'include' },
    );
    return response.ok ? PersonaCorrectionSchema.parse(await response.json()) : null;
  } catch {
    return null;
  }
}
