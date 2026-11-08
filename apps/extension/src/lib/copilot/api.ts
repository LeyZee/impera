import {
  ApiErrorSchema,
  CopilotDraftViewSchema,
  FanCardViewSchema,
  type CopilotDraftView,
  type FanCardView,
} from '@impera/contracts';

import type { Fetch } from '../session';

/**
 * What the panel reads from the CRM, with the CRM's session (ADR 0086 § 8): the conversation open in Reveal and its
 * draft every 5 s, the fan's card after. Nothing is written from here: the gestures go through the link (lot b, next).
 */

const READ_TIMEOUT_MS = 6000;

export type DraftRead =
  | { readonly kind: 'view'; readonly view: CopilotDraftView }
  /** 403 `copilot_shift_forbidden`: a chatter out of his shift on her (ADR 0086 § 7). */
  | { readonly kind: 'off_shift' }
  /** 403: she is not one of his creators. */
  | { readonly kind: 'forbidden' }
  /** 409 `copilot_creator_conflict`: two of his creators have a conversation of that id. */
  | { readonly kind: 'conflict' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'down' };

export type CardRead =
  | { readonly kind: 'card'; readonly card: FanCardView }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'down' };

async function getJson(fetchFn: Fetch, url: string): Promise<Response | null> {
  try {
    return await fetchFn(url, {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

async function codeOf(response: Response): Promise<string | null> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data.error.code : null;
}

export async function readDraftView(
  origin: string,
  platformConversationId: string,
  creatorId: string | null,
  fetchFn: Fetch = fetch,
): Promise<DraftRead> {
  const query = new URLSearchParams({ platform: 'reveal' });
  if (creatorId !== null) query.set('creatorId', creatorId);
  const response = await getJson(
    fetchFn,
    `${origin}/v1/copilot/conversations/${encodeURIComponent(platformConversationId)}/draft?${query.toString()}`,
  );
  if (response === null) return { kind: 'down' };
  if (response.status === 401) return { kind: 'signed_out' };
  if (response.status === 403)
    return (await codeOf(response)) === 'copilot_shift_forbidden'
      ? { kind: 'off_shift' }
      : { kind: 'forbidden' };
  if (response.status === 409) return { kind: 'conflict' };
  if (!response.ok) return { kind: 'down' };
  const view = CopilotDraftViewSchema.safeParse(await response.json().catch(() => null));
  return view.success ? { kind: 'view', view: view.data } : { kind: 'down' };
}

export async function readFanCard(
  origin: string,
  creatorId: string,
  fanId: string,
  fetchFn: Fetch = fetch,
): Promise<CardRead> {
  const response = await getJson(
    fetchFn,
    `${origin}/v1/fans/${encodeURIComponent(fanId)}/card?${new URLSearchParams({ creatorId }).toString()}`,
  );
  if (response === null) return { kind: 'down' };
  if (response.status === 403 || response.status === 404) return { kind: 'forbidden' };
  if (!response.ok) return { kind: 'down' };
  const card = FanCardViewSchema.safeParse(await response.json().catch(() => null));
  return card.success ? { kind: 'card', card: card.data } : { kind: 'down' };
}
