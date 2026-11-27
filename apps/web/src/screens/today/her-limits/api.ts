import {
  CreatorLimitsSchema,
  type CreatorId,
  type CreatorLimits,
  type NewAbsenceBody,
  type NewStopBody,
} from '@impera/contracts';
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { Outcome } from '@/screens/agenda/api';
import { send } from '@/screens/agenda/week-api';

/*
 * What she tells the agency herself (Charles, 21/11): hers under `/v1/creator-space/limits`, her team's under
 * `/v1/creators/:id/limits`. A change waits for the network and says so, as her day's ticks.
 */

const MINE_KEY = ['creator-space', 'limits'] as const;

async function readLimits(url: string): Promise<CreatorLimits> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET limits: ${String(response.status)}`);
  return CreatorLimitsSchema.parse(await response.json());
}

/** `GET /v1/creator-space/limits`: hers. */
export function useMyLimits(): UseQueryResult<CreatorLimits> {
  return useQuery({ queryKey: MINE_KEY, queryFn: () => readLimits('/v1/creator-space/limits'), retry: 1 });
}

/** `GET /v1/creators/:id/limits`: what a chatter on shift reads of her. */
export function useCreatorLimits(creatorId: CreatorId | null): UseQueryResult<CreatorLimits> {
  return useQuery({
    queryKey: ['creator-limits', creatorId],
    queryFn: () => readLimits(`/v1/creators/${String(creatorId)}/limits`),
    enabled: creatorId !== null,
    retry: 1,
    refetchInterval: 600_000,
  });
}

export const tellAbsence = (body: NewAbsenceBody): Promise<Outcome<null>> =>
  send('POST', '/v1/creator-space/absences', body);
export const cancelAbsence = (id: string): Promise<Outcome<null>> =>
  send('POST', `/v1/creator-space/absences/${id}/cancel`, {});
export const tellStop = (body: NewStopBody): Promise<Outcome<null>> =>
  send('POST', '/v1/creator-space/stops', body);
export const withdrawStop = (id: string): Promise<Outcome<null>> =>
  send('POST', `/v1/creator-space/stops/${id}/withdraw`, {});

export const readLimitsAgain = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ queryKey: MINE_KEY });
