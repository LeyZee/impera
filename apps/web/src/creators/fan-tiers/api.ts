import { FanTiersSettingSchema, type FanTiersSetting } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export const fanTiersKey = (creatorId: string): readonly string[] => ['creators', creatorId, 'fan-tiers'];
const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/fan-tiers`;

/** `GET /v1/creators/:id/fan-tiers` (owner): her fans' tier thresholds, the defaults when never set. */
export function useFanTiers(creatorId: string): UseQueryResult<FanTiersSetting> {
  return useQuery({
    queryKey: fanTiersKey(creatorId),
    queryFn: async (): Promise<FanTiersSetting> => {
      const response = await fetch(path(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET fan-tiers: ${String(response.status)}`);
      return FanTiersSettingSchema.parse(await response.json());
    },
  });
}

/** `PUT /v1/creators/:id/fan-tiers` (owner): all three at once; `false` when the server refused or was not reached. */
export async function saveFanTiers(creatorId: string, tiers: FanTiersSetting): Promise<boolean> {
  try {
    const response = await fetch(path(creatorId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tiers),
    });
    return response.ok;
  } catch {
    return false;
  }
}
