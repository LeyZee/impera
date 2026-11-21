import { HerDaySchema, type DayItem, type HerDay } from '@impera/contracts';
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { Outcome } from './api';
import { send } from './week-api';

/*
 * Her day (ADR 0140, second avenant, `/v1/creator-space/day`): read online, parsed with the strict contract; a tick
 * waits for the network and says so, like her week's.
 */

export const DAY_KEY = ['creator-space', 'day'] as const;

/** `GET /v1/creator-space/day`: today in her zone. */
export function useCreatorDay(): UseQueryResult<HerDay> {
  return useQuery({
    queryKey: DAY_KEY,
    queryFn: async () => {
      const response = await fetch('/v1/creator-space/day', { credentials: 'include' });
      if (!response.ok) throw new Error(`GET day: ${String(response.status)}`);
      return HerDaySchema.parse(await response.json());
    },
    retry: 1,
    retryDelay: 400,
  });
}

/** How many of a line she did that day. */
export const tickDayItem = (day: string, item: DayItem, done: number): Promise<Outcome<null>> =>
  send('PUT', `/v1/creator-space/day/${day}/items/${item}`, { done });

export const readDayAgain = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ queryKey: DAY_KEY });
