import { ToTalkSchema, type ToTalk } from '@impera/contracts';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';

/** `GET /v1/conversations/to-talk` (Charles, 21/11): who to write to first, read each minute like « À traiter ». */
export function useToTalk(creatorId: string): UseQueryResult<ToTalk> {
  return useQuery({
    queryKey: ['conversations', 'to-talk', creatorId],
    queryFn: async (): Promise<ToTalk> => {
      const query = new URLSearchParams({ creatorId });
      const response = await fetch(`/v1/conversations/to-talk?${query.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error(`GET /v1/conversations/to-talk: ${String(response.status)}`);
      return ToTalkSchema.parse(await response.json());
    },
    refetchInterval: 60_000,
  });
}
