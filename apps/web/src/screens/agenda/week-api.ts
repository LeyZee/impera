import { ApiErrorSchema, CreatorWeekSchema, type CreatorWeek } from '@impera/contracts';
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import { AGENDA_KEY, type Outcome } from './api';

/*
 * Her week of shooting (ADR 0140, `/v1/creator-space/week`): read online, parsed with the strict contract; accepting it
 * and ticking a line wait for the network and say so, like every change of her agenda but a task's tick.
 */

export const WEEK_KEY = ['creator-space', 'week'] as const;

/** `GET /v1/creator-space/week?week=`: her week starting on `monday`, empty until the agency sends it. */
export function useCreatorWeek(monday: string): UseQueryResult<CreatorWeek> {
  return useQuery({
    queryKey: [...WEEK_KEY, monday],
    queryFn: async () => {
      const response = await fetch(`/v1/creator-space/week?week=${monday}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`GET week: ${String(response.status)}`);
      return CreatorWeekSchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

export async function send(method: 'POST' | 'PUT', url: string, body: unknown): Promise<Outcome<null>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'offline' };
  }
  try {
    if (response.status >= 500) return { kind: 'failed' };
    if (!response.ok) {
      const refusal = ApiErrorSchema.safeParse(await response.json().catch(() => null));
      return refusal.success ? { kind: 'refused', code: refusal.data.error.code } : { kind: 'failed' };
    }
    return { kind: 'ok', value: null };
  } catch {
    return { kind: 'failed' };
  }
}

/** « Accepter ma semaine »: each of its tasks still to decide, accepted as it is. */
export const acceptWeek = (monday: string): Promise<Outcome<null>> =>
  send('POST', '/v1/creator-space/week/accept', { week: monday });

/** A line of a shooting day shot, or taken back. */
export const tickShootItem = (itemId: string, done: boolean): Promise<Outcome<null>> =>
  send('PUT', `/v1/creator-space/shoot-items/${itemId}`, { done });

/** After a change: her week and her agenda read again (the day's task ticks with its last line). */
export const readWeekAgain = (client: QueryClient): Promise<unknown> =>
  Promise.all([
    client.invalidateQueries({ queryKey: WEEK_KEY }),
    client.invalidateQueries({ queryKey: AGENDA_KEY }),
  ]);
