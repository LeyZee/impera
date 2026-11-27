import { ChatterPersonaSchema, type ChatterPersona } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/** `GET /v1/creators/:id/persona/chatter`: her active version as a chatter reads it, `sheet: null` without one. */
export function useChatterPersona(creatorId: string): UseQueryResult<ChatterPersona> {
  return useQuery({
    queryKey: ['persona', 'chatter', creatorId],
    queryFn: async (): Promise<ChatterPersona> => {
      const response = await fetch(`/v1/creators/${encodeURIComponent(creatorId)}/persona/chatter`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`GET persona/chatter: ${String(response.status)}`);
      return ChatterPersonaSchema.parse(await response.json());
    },
    staleTime: 600_000,
  });
}
