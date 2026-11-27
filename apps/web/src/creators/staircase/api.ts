import { StaircaseSettingSchema, type StaircaseSetting } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export const staircaseKey = (creatorId: string): readonly string[] => ['creators', creatorId, 'staircase'];
const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/staircase`;

/** `GET /v1/creators/:id/staircase` (owner): the agency's settings of her scripts' staircase, empty until set. */
export function useStaircase(creatorId: string): UseQueryResult<StaircaseSetting> {
  return useQuery({
    queryKey: staircaseKey(creatorId),
    queryFn: async (): Promise<StaircaseSetting> => {
      const response = await fetch(path(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET staircase: ${String(response.status)}`);
      return StaircaseSettingSchema.parse(await response.json());
    },
  });
}

/** `PUT /v1/creators/:id/staircase` (owner): all of them at once; `false` when the server refused or was not reached. */
export async function saveStaircase(creatorId: string, setting: StaircaseSetting): Promise<boolean> {
  try {
    const response = await fetch(path(creatorId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(setting),
    });
    return response.ok;
  } catch {
    return false;
  }
}
