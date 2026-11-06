import { CreatorsOverviewSchema, type CreatorOverview } from '@impera/contracts';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * `GET /v1/dashboard/creators` (« ok liste-créatrices », 06/11): one card per creator of the list of Créatrices, as the
 * server reads them with the reader's rights. Under ['dashboard'], so what reads the Dashboard again reads these too.
 */
async function fetchCreatorsOverview(): Promise<CreatorOverview[]> {
  const response = await fetch('/v1/dashboard/creators', { credentials: 'include' });
  if (!response.ok) throw new Error(`GET /v1/dashboard/creators: ${String(response.status)}`);
  return CreatorsOverviewSchema.parse(await response.json()).creators;
}

export const creatorsOverviewQuery = queryOptions({
  queryKey: ['dashboard', 'creators'],
  queryFn: fetchCreatorsOverview,
  retry: 1,
  refetchInterval: 60_000,
});

export function useCreatorsOverview(): UseQueryResult<CreatorOverview[]> {
  return useQuery(creatorsOverviewQuery);
}
