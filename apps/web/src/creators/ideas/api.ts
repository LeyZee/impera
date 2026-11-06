import {
  ApiErrorSchema,
  CONTENT_IDEA_DECIDED_CONFLICT,
  CONTENT_IDEA_GUARD_UNPROCESSABLE,
  ContentIdeaListSchema,
  ContentIdeaSchema,
  PastedTrendLinkSchema,
  ValidatedContentIdeaSchema,
  type ContentIdea,
  type ContentIdeaCorrection,
  type ContentIdeaId,
  type ContentIdeaList,
  type CreatorId,
  type PasteTrendLinkBody,
  type PastedTrendLink,
  type ValidatedContentIdea,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * « Idées du jour » (VEI-02, ADR 0060 § 5) and « Coller un lien » (§ 2, source 4), the owner's and an active
 * manager's. Every answer is parsed with the contract: a shape the page does not expect reads as « Le serveur ne
 * répond pas », never as a guess.
 */

export const ideasKey = (creatorId: CreatorId, day: string) => ['creators', creatorId, 'ideas', day] as const;

/** Her ideas of one of her days. */
export function useIdeas(creatorId: CreatorId, day: string): UseQueryResult<ContentIdeaList> {
  return useQuery({
    queryKey: ideasKey(creatorId, day),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/ideas?day=${day}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET ideas: ${String(response.status)}`);
      return ContentIdeaListSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export type IdeaRefusal =
  /** 409: someone decided it meanwhile. */
  | 'decided'
  /** 422: as corrected, it touches one of her limits or breaks a guard; the server says which. */
  | 'guarded'
  /** 403 or 404: not hers to decide, or gone. */
  | 'forbidden'
  | 'failed';

export type IdeaOutcome<T> =
  { readonly kind: 'ok'; readonly value: T } | { readonly kind: IdeaRefusal; readonly message: string };

export const IDEA_ERRORS: Readonly<Record<Exclude<IdeaRefusal, 'guarded'>, string>> = {
  decided: 'Cette idée vient d’être décidée par quelqu’un d’autre : la liste se met à jour.',
  forbidden: 'Seuls le propriétaire et un manager actif décident des idées d’une créatrice.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a changé.',
};

async function send<T>(path: string, body: unknown, read: (json: unknown) => T): Promise<IdeaOutcome<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'failed', message: IDEA_ERRORS.failed };
  }
  if (response.ok) {
    try {
      return { kind: 'ok', value: read(await response.json()) };
    } catch {
      return { kind: 'failed', message: IDEA_ERRORS.failed };
    }
  }
  const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  const code = refusal.success ? refusal.data.error.code : null;
  if (code === CONTENT_IDEA_DECIDED_CONFLICT) return { kind: 'decided', message: IDEA_ERRORS.decided };
  // The server's sentence names the guard (her limit, « jamais de nu », Instagram): said as it is.
  if (code === CONTENT_IDEA_GUARD_UNPROCESSABLE && refusal.success) {
    return { kind: 'guarded', message: `${refusal.data.error.message}.` };
  }
  if (response.status === 403 || response.status === 404) {
    return { kind: 'forbidden', message: IDEA_ERRORS.forbidden };
  }
  return { kind: 'failed', message: IDEA_ERRORS.failed };
}

/** Validates an idea, as it is or corrected: it becomes a suggestion in her agenda. */
export function validateIdea(
  creatorId: CreatorId,
  ideaId: ContentIdeaId,
  correction: ContentIdeaCorrection | null,
): Promise<IdeaOutcome<ValidatedContentIdea>> {
  return send(`/v1/creators/${creatorId}/ideas/${ideaId}/validate`, { correction }, (json) =>
    ValidatedContentIdeaSchema.parse(json),
  );
}

/** Refuses an idea, with a reason or not: it is never proposed again. */
export function refuseIdea(
  creatorId: CreatorId,
  ideaId: ContentIdeaId,
  reason: string | null,
): Promise<IdeaOutcome<ContentIdea>> {
  return send(`/v1/creators/${creatorId}/ideas/${ideaId}/refuse`, { reason }, (json) =>
    ContentIdeaSchema.parse(json),
  );
}

export type PasteOutcome =
  | { readonly kind: 'ok'; readonly pasted: PastedTrendLink }
  | { readonly kind: 'refused' | 'forbidden' | 'failed' };

export const PASTE_ERRORS: Readonly<Record<Exclude<PasteOutcome['kind'], 'ok'>, string>> = {
  refused: 'Ce lien ne passe pas tel quel : colle l’adresse d’un post ou d’un reel Instagram.',
  forbidden: 'Ce lien ne peut pas être collé pour cette créatrice.',
  failed: 'Le serveur ne répond pas. Réessaie dans un instant : rien n’a été ajouté.',
};

/** `POST /v1/trends/links`: a post seen on Instagram, as a trend of hers. The server never opens it. */
export async function pasteLink(body: PasteTrendLinkBody): Promise<PasteOutcome> {
  try {
    const response = await fetch('/v1/trends/links', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.ok) return { kind: 'ok', pasted: PastedTrendLinkSchema.parse(await response.json()) };
    if (response.status === 403) return { kind: 'forbidden' };
    if (response.status === 400 || response.status === 422) return { kind: 'refused' };
    return { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
