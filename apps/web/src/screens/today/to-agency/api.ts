import {
  ToAgencyMessagesSchema,
  WaitingToAgencyMessagesSchema,
  type CreatorId,
  type NewToAgencyMessageBody,
  type ToAgencyMessages,
  type WaitingToAgencyMessages,
} from '@impera/contracts';
import { useQuery, type QueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { Outcome } from '@/screens/agenda/api';
import { send } from '@/screens/agenda/week-api';

/*
 * « Écrire à l'agence » (trous béants n° 13): hers under `/v1/creator-space/messages`, the agency's waiting list under
 * `/v1/creator-messages/waiting`, the owner's answer under `/v1/creators/:id/messages/:id/answer`. Parsed with the
 * contract; a gesture waits for the network and says so.
 */

const MINE_KEY = ['creator-space', 'messages'] as const;
const WAITING_KEY = ['creator-messages', 'waiting'] as const;

export function useMyMessages(): UseQueryResult<ToAgencyMessages> {
  return useQuery({
    queryKey: MINE_KEY,
    queryFn: async () => {
      const response = await fetch('/v1/creator-space/messages', { credentials: 'include' });
      if (!response.ok) throw new Error(`GET messages: ${String(response.status)}`);
      return ToAgencyMessagesSchema.parse(await response.json());
    },
    retry: 1,
    refetchInterval: 300_000,
  });
}

/** What waits on the agency, every creator: the owner's and an active manager's read. */
export function useWaitingMessages(enabled: boolean): UseQueryResult<WaitingToAgencyMessages> {
  return useQuery({
    queryKey: WAITING_KEY,
    queryFn: async () => {
      const response = await fetch('/v1/creator-messages/waiting', { credentials: 'include' });
      if (!response.ok) throw new Error(`GET waiting messages: ${String(response.status)}`);
      return WaitingToAgencyMessagesSchema.parse(await response.json());
    },
    enabled,
    retry: 1,
    refetchInterval: 120_000,
  });
}

export const writeToAgency = (body: NewToAgencyMessageBody): Promise<Outcome<null>> =>
  send('POST', '/v1/creator-space/messages', body);

export const answerMessage = (creatorId: CreatorId, id: string, answer: string): Promise<Outcome<null>> =>
  send('POST', `/v1/creators/${creatorId}/messages/${id}/answer`, { answer });

export const readMineAgain = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ queryKey: MINE_KEY });
export const readWaitingAgain = (client: QueryClient): Promise<void> =>
  client.invalidateQueries({ queryKey: WAITING_KEY });
