import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import type { JSX } from 'react';

import { pillOf } from '@/agent/mode';
import { pillStatusLabel } from '@/agent/state';
import { useAgentMode } from '@/agent/useAgentMode';
import { useCreators } from '@/creators/api';
import { creatorsOverviewQuery } from '@/creators/overview/api';

const TITLE = {
  unavailable: 'Le serveur ne répond pas : mode de l’agent inconnu. Ouvrir le Dashboard.',
  empty: 'Aucune créatrice encore : pas d’agent à suivre. Ouvrir le Dashboard.',
} as const;

/**
 * What the agent does right now, read-only, in the bar of every screen but the Dashboard. The control itself lives on
 * the Dashboard (one control, decided 17/10): the pill only opens it. It shows the server's mode only: « Injoignable »
 * when the server does not answer, « Sans créatrice » before any creator, a quiet dot while it is asked (NAV-05: the
 * word « Agent » is the pill's own, never said twice). With several creators it names the one followed (DASH-03): the
 * mode of one is not the mode of all.
 */
export function AgentPill(): JSX.Element {
  // On a creator's sheet, the pill speaks of her, not of the one the Dashboard follows (recette 05/11, PRO-28).
  const shown = useRouterState({
    select: ({ location }) => {
      const search: Record<string, unknown> = location.search;
      const { creatrice } = search;
      return location.pathname.startsWith('/creatrices') && typeof creatrice === 'string' ? creatrice : null;
    },
  });
  const view = useAgentMode(shown);
  const live = view.source === 'live' ? view : null;
  const stalled = live?.stalled ?? null;
  // What runs for her, from her card (recette 27/11, PRO-15): never « Copilote » for an agent that writes nothing. A
  // reader without the list of Créatrices, or an older server, gets her mode as before.
  const overview = useQuery({ ...creatorsOverviewQuery, enabled: live !== null });
  const status = overview.data?.find((card) => card.creatorId === live?.creatorId)?.agentStatus;
  const said = live === null || live.mode === 'stop' ? null : pillStatusLabel(status);
  const modePill = pillOf(live?.mode ?? null, stalled === null);
  const pill =
    said === null
      ? modePill
      : {
          label: said,
          tone:
            status === 'no_persona' || status === 'no_scripts' || status === 'session_expired'
              ? ('warn' as const)
              : ('unknown' as const),
          live: false,
        };
  const several = (useCreators().data?.length ?? 0) >= 2;
  const mode = view.source === 'loading' ? '…' : view.source === 'empty' ? 'Sans créatrice' : pill.label;
  const label = live !== null && several ? `${live.creatorName} · ${mode}` : mode;
  const title =
    view.source === 'loading'
      ? 'Agent : lecture en cours.'
      : view.source === 'unavailable' || view.source === 'empty'
        ? TITLE[view.source]
        : stalled !== null && live?.mode !== 'stop'
          ? `Agent : ${label}, mais rien ne tourne : ${stalled}. Voir le Dashboard.`
          : `Agent : ${label}. Le changer sur le Dashboard.`;
  return (
    <Link
      to="/"
      search={shown === null ? {} : { creatrice: shown }}
      className="nv-rail__agent"
      data-tone={pill.tone}
      title={title}
      aria-label={title}
    >
      <span
        className={`nv-dot${pill.tone === 'unknown' ? '' : ` nv-tone--${pill.tone}`}${pill.live ? ' nv-dot--live' : ''}`}
        aria-hidden="true"
      />
      {/* A long name is cut with « … » inside the pill, its title keeping it whole (recette 05/11, PRO-12). */}
      {live !== null && several ? (
        <>
          <span className="nv-rail__agent-label">{live.creatorName}</span>{' '}
          <span className="nv-rail__agent-mode">· {mode}</span>
        </>
      ) : (
        <span className="nv-rail__agent-label">{label}</span>
      )}
    </Link>
  );
}
