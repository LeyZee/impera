import { useMemo } from 'react';

import { fromApi, type DashboardReader } from './live';
import type { Dashboard, Period } from './model';

import { useLiveDashboard } from '@/agent/live';
import type { AgentMode, AutomaticGate } from '@/agent/mode';

/**
 * What the Dashboard can show:
 * - `loading` until the server answers;
 * - `live`, the server's data;
 * - `offline`, the server does not answer: no figure, nothing to act on, only that sentence;
 * - `empty`, no creator exists yet (first launch): the screen asks for one, never a made-up page (DASH-13).
 */
export type DashboardView =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'offline'; readonly creatorName: string | null }
  | {
      readonly status: 'live';
      /** The creator the control writes for. */
      readonly creatorId: string;
      /** An operator's global switch holds every creator: Arrêt whatever she picks, until it is lifted. */
      readonly globalStop: boolean;
      /** When the server last answered: a notice about a change holds until the next answer. */
      readonly readAt: number;
      readonly data: Dashboard;
      readonly mode: AgentMode;
      readonly automatic: AutomaticGate;
    };

/** The one door of the Dashboard to its data: `GET /v1/dashboard` for the period. */
export function useDashboard(period: Period, reader: DashboardReader = 'owner'): DashboardView {
  const live = useLiveDashboard(period);
  const liveData = live.kind === 'live' ? live.data : undefined;
  const data = useMemo(() => (liveData === undefined ? null : fromApi(liveData, reader)), [liveData, reader]);
  switch (live.kind) {
    case 'loading':
      return { status: 'loading' };
    case 'unavailable':
      return { status: 'offline', creatorName: live.creatorName };
    case 'empty':
      return { status: 'empty' };
    case 'live':
      // The period's own read carries the mode too: the control follows the page it is on.
      return {
        status: 'live',
        creatorId: live.data.creator.id,
        globalStop: live.data.globalStop,
        readAt: live.readAt,
        data: data ?? fromApi(live.data),
        mode: live.data.mode,
        automatic: live.data.automatic,
      };
  }
}
