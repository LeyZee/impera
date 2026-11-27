import {
  ApiErrorSchema,
  FanTiersSettingSchema,
  REAUTHENTICATION_ERROR_CODE,
  StaircaseSettingSchema,
  type FanTiersSetting,
  type StaircaseSetting,
} from '@impera/contracts';
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

export const startCapKey = (creatorId: string): readonly string[] => ['creators', creatorId, 'staircase'];
const startCapPath = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/staircase`;

/** `GET /v1/creators/:id/staircase` (owner): the agency's cap at a script's start, empty until set. */
export function useStartCap(creatorId: string): UseQueryResult<StaircaseSetting> {
  return useQuery({
    queryKey: startCapKey(creatorId),
    queryFn: async (): Promise<StaircaseSetting> => {
      const response = await fetch(startCapPath(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET staircase: ${String(response.status)}`);
      return StaircaseSettingSchema.parse(await response.json());
    },
  });
}

/**
 * `PUT /v1/creators/:id/staircase` (owner, recent sign-in): `reauth` when the server wants the password and the code
 * again (EQ-15), `failed` when it refused otherwise or was not reached.
 */
export async function saveStartCap(
  creatorId: string,
  setting: StaircaseSetting,
): Promise<'ok' | 'reauth' | 'failed'> {
  try {
    const response = await fetch(startCapPath(creatorId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(setting),
    });
    if (response.ok) return 'ok';
    const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
    return parsed.success && parsed.data.error.code === REAUTHENTICATION_ERROR_CODE ? 'reauth' : 'failed';
  } catch {
    return 'failed';
  }
}
