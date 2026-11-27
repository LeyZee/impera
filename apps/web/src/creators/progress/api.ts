import { CreatorProgressSchema, type CreatorId, type CreatorProgress } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/*
 * `GET /v1/creators/:creatorId/progress?week=` (trous béants n° 11), the owner's and an active manager's: her seven
 * days and her validated week, as she reads them. Parsed with the contract.
 */

export const creatorProgressKey = (creatorId: CreatorId, week: string) =>
  ['creators', creatorId, 'progress', week] as const;

export function useCreatorProgress(creatorId: CreatorId, week: string): UseQueryResult<CreatorProgress> {
  return useQuery({
    queryKey: creatorProgressKey(creatorId, week),
    queryFn: async () => {
      const response = await fetch(`/v1/creators/${creatorId}/progress?week=${week}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`GET progress: ${String(response.status)}`);
      return CreatorProgressSchema.parse(await response.json());
    },
    refetchInterval: 120_000,
    retry: 1,
    retryDelay: 400,
  });
}
