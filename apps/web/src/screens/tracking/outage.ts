import { useQuery } from '@tanstack/react-query';

import { todosAcrossQuery } from './api';
import { outageZone } from './view';

import { useCreators } from '@/creators/api';

/** No model answers the agent (recette 27/11, A9): since when, and the clock that hour is said at. */
export interface AiOutageNow {
  readonly since: string | null;
  readonly zone: string;
}

/**
 * The outage as Suivi's banner reads it, for every place that says her AI's state (the menu's pill, her card, her
 * sheet's header): one reading of « À traiter » (shared with the rail's count), one clock. `null` while models answer.
 */
export function useAiOutage(enabled = true): AiOutageNow | null {
  const queue = useQuery({ ...todosAcrossQuery, enabled });
  const creators = useCreators().data ?? [];
  const outage = enabled ? (queue.data?.aiOutage ?? null) : null;
  return outage === null
    ? null
    : { since: outage.since, zone: outageZone(creators.map((creator) => creator.timezone)) };
}
