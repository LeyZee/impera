import {
  CreatorSetupListSchema,
  MemberSetupListSchema,
  type CreatorSetup,
  type MemberSetup,
} from '@impera/contracts';
import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';

/**
 * « Mise en route » (pilotage plan W1): `GET /v1/dashboard/setup/creators` and `/members`, the owner's alone, each step
 * ticked by the server. Under ['dashboard'], so what reads the Dashboard again reads these too; read again whenever a
 * sheet opens, so a step done elsewhere a minute ago shows ticked.
 */
async function fetchList<T>(path: 'creators' | 'members', parse: (body: unknown) => T): Promise<T> {
  const response = await fetch(`/v1/dashboard/setup/${path}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET /v1/dashboard/setup/${path}: ${String(response.status)}`);
  return parse(await response.json());
}

export const creatorSetupQuery = queryOptions({
  queryKey: ['dashboard', 'setup', 'creators'],
  queryFn: () => fetchList('creators', (body) => CreatorSetupListSchema.parse(body).creators),
  retry: 1,
});

export const memberSetupQuery = queryOptions({
  queryKey: ['dashboard', 'setup', 'members'],
  queryFn: () => fetchList('members', (body) => MemberSetupListSchema.parse(body).members),
  retry: 1,
});

/** Every creator's setup; `enabled` false for anyone but the owner, who would get a 403. */
export function useCreatorSetups(enabled: boolean): UseQueryResult<CreatorSetup[]> {
  return useQuery({ ...creatorSetupQuery, enabled });
}

export function useMemberSetups(enabled: boolean): UseQueryResult<MemberSetup[]> {
  return useQuery({ ...memberSetupQuery, enabled });
}
