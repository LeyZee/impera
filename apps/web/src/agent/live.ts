import { DashboardSchema, type Dashboard as ApiDashboard, type DashboardPeriod } from '@nirvana/contracts';
import { useQuery } from '@tanstack/react-query';

import { followedOf, useFollowedCreatorId } from './followed';

import { creatorsQuery } from '@/creators/api';

/** How often the Dashboard and the bar read the agent again, as Suivi does. */
const REFRESH_MS = 30_000;

/** `GET /v1/dashboard`: everything the Dashboard shows for one creator, computed by the server, parsed with the contract. */
async function fetchDashboard(creatorId: string, period: DashboardPeriod): Promise<ApiDashboard> {
  const query = new URLSearchParams({ creatorId, period });
  const response = await fetch(`/v1/dashboard?${query.toString()}`, { credentials: 'include' });
  if (!response.ok) throw new Error(`GET /v1/dashboard: ${String(response.status)}`);
  return DashboardSchema.parse(await response.json());
}

/**
 * What the server says, or why it says nothing: `loading` until it answers, `unavailable` when it fails (the screen
 * says so and shows no figure), `empty` when no creator exists yet (first launch: the sample, marked as such).
 */
export type LiveDashboard =
  | { readonly kind: 'loading' }
  | { readonly kind: 'live'; readonly data: ApiDashboard; readonly readAt: number }
  | { readonly kind: 'unavailable'; readonly creatorName: string | null }
  | { readonly kind: 'empty' };

/**
 * The Dashboard of the followed creator (`agent/followed.ts`: chosen on the Dashboard, the first one otherwise),
 * shared by the Dashboard and the bar's pill through the query cache. A failed read is never covered by an older
 * answer: the screen says the server does not answer until it does again. Suivi's « À traiter » does not read it: it
 * reads every creator followed (`GET /v1/dashboard/todos`, SUIVI-09).
 */
export function useLiveDashboard(period: DashboardPeriod = 'day'): LiveDashboard {
  const creators = useQuery({
    ...creatorsQuery,
    // Read again while it fails, so the page comes back on its own once the server does.
    refetchInterval: (query) => (query.state.status === 'error' ? REFRESH_MS : false),
  });
  const { chosen } = useFollowedCreatorId();
  const creator = followedOf(creators.data ?? [], chosen);
  const dashboard = useQuery({
    queryKey: ['dashboard', creator?.id, period],
    queryFn: () => fetchDashboard(creator?.id ?? '', period),
    enabled: creator !== undefined,
    refetchInterval: REFRESH_MS,
    // A new period keeps the page on the last answer while it is read: no flash back to loading. Another creator
    // does not: her page never shows under the name of the one before.
    placeholderData: (previous) => (previous?.creator.id === creator?.id ? previous : undefined),
    // One retry, then the page says the server does not answer: a server down must not leave it loading.
    retry: 1,
  });
  if (creators.isError) return { kind: 'unavailable', creatorName: creator?.displayName ?? null };
  if (creators.isSuccess && creator === undefined) return { kind: 'empty' };
  if (dashboard.isError) return { kind: 'unavailable', creatorName: creator?.displayName ?? null };
  if (dashboard.data !== undefined)
    return { kind: 'live', data: dashboard.data, readAt: dashboard.dataUpdatedAt };
  return { kind: 'loading' };
}
