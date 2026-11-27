import {
  ChannelGestureRefusalBodySchema,
  ChannelPlannedPostSchema,
  ChannelWeekSchema,
  refusalOf,
  type ChannelPlannedPost,
  type ChannelPostGesture,
  type ChannelWeek,
} from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { ChannelError, ChannelRefused } from '../api';

/**
 * Her channel's week (ADR 0162 § 3): `GET .../telegram-channel/week?week=`, the gestures on one post, « Tout valider »
 * on the week. The owner's alone for now. Every answer is parsed with the contract; a refusal of a gesture is a
 * `ChannelRefused` with the server's sentence (« Son heure est passée… »).
 */

const base = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/telegram-channel`;

async function send<T>(what: string, url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'include', ...init });
  } catch {
    throw new ChannelError('unavailable', `${what}: réseau`);
  }
  const detail = `${what}: ${String(response.status)}`;
  const body: unknown = await response.json().catch(() => null);
  if (response.ok) {
    const parsed = schema.safeParse(body);
    if (parsed.success) return parsed.data;
    throw new ChannelError('unavailable', `${detail}, réponse inattendue`);
  }
  if (response.status === 400) {
    const refused = ChannelGestureRefusalBodySchema.safeParse(body);
    if (refused.success) throw new ChannelRefused(refusalOf(refused.data).message);
    throw new ChannelError('rejected', detail);
  }
  if (response.status === 401) throw new ChannelError('session_expired', detail);
  if (response.status === 403) throw new ChannelError('forbidden', detail);
  if (response.status === 404) throw new ChannelError('not_found', detail);
  throw new ChannelError('unavailable', detail);
}

export const weekQueryKey = (creatorId: string, week: string): readonly string[] => [
  'telegram-channel-week',
  creatorId,
  week,
];

export function useChannelWeek(creatorId: string, week: string): UseQueryResult<ChannelWeek> {
  return useQuery({
    queryKey: weekQueryKey(creatorId, week),
    queryFn: () =>
      send(
        'GET telegram-channel/week',
        `${base(creatorId)}/week?week=${encodeURIComponent(week)}`,
        ChannelWeekSchema,
      ),
    retry: 1,
    retryDelay: 400,
  });
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** One gesture on one post; answers with the post as it now stands (its replacement is read with the week again). */
export const channelGesture = (
  creatorId: string,
  postId: string,
  gesture: ChannelPostGesture,
): Promise<ChannelPlannedPost> =>
  send(
    `POST telegram-channel/posts (${gesture.gesture})`,
    `${base(creatorId)}/posts/${encodeURIComponent(postId)}`,
    ChannelPlannedPostSchema,
    json(gesture),
  );

const ValidatedSchema = z.object({ validated: z.number().int().nonnegative() });

/** « Tout valider »: every post of the week that waits for a read, in one call. */
export const validateChannelWeek = async (creatorId: string, week: string): Promise<number> =>
  (
    await send(
      'POST telegram-channel/week/validate',
      `${base(creatorId)}/week/validate`,
      ValidatedSchema,
      json({ week }),
    )
  ).validated;
