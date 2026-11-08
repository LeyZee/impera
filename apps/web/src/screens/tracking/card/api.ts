import {
  FanCardViewSchema,
  type FanCardField,
  type FanCardView,
  type SetFanCardFieldBody,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { cardError } from './model';

/** The card fills as the AI reads his messages: read again now and then, like the rest of the sheet. */
const REFRESH_MS = 30_000;

/** A server that refuses (403, 404) is not asked again until the reader opens him again. */
export class FanCardRefused extends Error {}

const cardPath = (creatorId: string, fanId: string, field?: FanCardField): string =>
  `/v1/fans/${encodeURIComponent(fanId)}/card${field === undefined ? '' : `/${field}`}?${new URLSearchParams({ creatorId }).toString()}`;

/** `GET /v1/fans/:id/card` (ADR 0085 § 10). */
export async function fetchFanCard(creatorId: string, fanId: string): Promise<FanCardView> {
  const response = await fetch(cardPath(creatorId, fanId), { credentials: 'include' });
  if (response.status === 403 || response.status === 404)
    throw new FanCardRefused(`GET card: ${String(response.status)}`);
  if (!response.ok) throw new Error(`GET card: ${String(response.status)}`);
  return FanCardViewSchema.parse(await response.json());
}

export const fanCardKey = (creatorId: string, fanId: string): readonly string[] => [
  'fan-card',
  creatorId,
  fanId,
];

/** His card, never read for a creator (ADR 0063): `enabled` is false for her, and the server would refuse her. */
export function useFanCard(creatorId: string, fanId: string, enabled: boolean): UseQueryResult<FanCardView> {
  return useQuery({
    queryKey: fanCardKey(creatorId, fanId),
    queryFn: () => fetchFanCard(creatorId, fanId),
    enabled,
    retry: (failures, error) => !(error instanceof FanCardRefused) && failures < 3,
    refetchInterval: (query) => (query.state.error instanceof FanCardRefused ? false : REFRESH_MS),
  });
}

/** His card after a change, or why it was refused (nothing was written). */
export type CardChange =
  { readonly ok: true; readonly view: FanCardView } | { readonly ok: false; readonly message: string };

/** `PUT /v1/fans/:id/card/:field` (§ 6): a chatter writes, keeps or clears a field in one gesture. */
export async function setFanCardField(
  creatorId: string,
  fanId: string,
  field: FanCardField,
  body: SetFanCardFieldBody,
): Promise<CardChange> {
  try {
    const response = await fetch(cardPath(creatorId, fanId, field), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const answer: unknown = await response.json().catch(() => null);
      return { ok: false, message: cardError(response.status, answer) };
    }
    return { ok: true, view: FanCardViewSchema.parse(await response.json()) };
  } catch {
    return { ok: false, message: cardError(0, null) };
  }
}
