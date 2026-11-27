import { MeetingTiersBodySchema, type MeetingTierSettings } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

export const meetingTiersKey = (creatorId: string): readonly string[] => [
  'creators',
  creatorId,
  'meeting-tiers',
];
const path = (creatorId: string): string => `/v1/creators/${encodeURIComponent(creatorId)}/meeting-tiers`;

/** `GET /v1/creators/:id/meeting-tiers` (owner): her three durations, `null` when never set. */
export function useMeetingTiers(creatorId: string): UseQueryResult<MeetingTierSettings | null> {
  return useQuery({
    queryKey: meetingTiersKey(creatorId),
    queryFn: async (): Promise<MeetingTierSettings | null> => {
      const response = await fetch(path(creatorId), { credentials: 'include' });
      if (!response.ok) throw new Error(`GET meeting-tiers: ${String(response.status)}`);
      return MeetingTiersBodySchema.parse(await response.json()).settings;
    },
  });
}

/**
 * `PUT /v1/creators/:id/meeting-tiers` (owner): the three at once, or `null` to remove them; `false` when the server
 * refused or was not reached.
 */
export async function saveMeetingTiers(
  creatorId: string,
  settings: MeetingTierSettings | null,
): Promise<boolean> {
  try {
    const response = await fetch(path(creatorId), {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
