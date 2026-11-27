import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import type { JSX } from 'react';

import { pillOf } from '@/agent/mode';
import { pillStatusLabel } from '@/agent/state';
import { useAgentMode } from '@/agent/useAgentMode';
import { useCreators } from '@/creators/api';
import { creatorsOverviewQuery } from '@/creators/overview/api';
import { todosAcrossQuery } from '@/screens/tracking/api';
import { outageWords, outageZone } from '@/screens/tracking/view';

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
  // No model answers (recette 27/11, A9): the pill says the outage as Suivi's banner does, from the same reading, red as
  // its dot. An Arrêt someone chose stays said by its mode.
  const queue = useQuery({ ...todosAcrossQuery, enabled: live !== null });
  const aiOutage = live === null || live.mode === 'stop' ? null : (queue.data?.aiOutage ?? null);
  const modePill = pillOf(live?.mode ?? null, stalled === null);
  const pill: {
    readonly label: string;
    readonly tone: 'ok' | 'warn' | 'bad' | 'unknown';
    readonly live: boolean;
  } =
    aiOutage !== null
      ? { label: 'IA indisponible', tone: 'bad', live: false }
      : said === null
        ? modePill
        : {
            label: said,
            tone:
              status === 'no_persona' || status === 'no_scripts' || status === 'session_expired'
                ? 'warn'
                : 'unknown',
            live: false,
          };
  const creators = useCreators().data ?? [];
  const several = creators.length >= 2;
  const mode = view.source === 'loading' ? '…' : view.source === 'empty' ? 'Sans créatrice' : pill.label;
  const label = live !== null && several ? `${live.creatorName} · ${mode}` : mode;
  const title =
    view.source === 'loading'
      ? 'Agent : lecture en cours.'
      : view.source === 'unavailable' || view.source === 'empty'
        ? TITLE[view.source]
        : aiOutage !== null
          ? `Agent : ${live !== null && several ? `${live.creatorName} · ` : ''}${outageWords(aiOutage, outageZone(creators.map((creator) => creator.timezone)))} Voir le Dashboard.`
          : stalled !== null && live?.mode !== 'stop'
            ? `Agent : ${label}, mais rien ne tourne : ${stalled}. Voir le Dashboard.`
            : `Agent : ${label}. Le changer sur le Dashboard.`;
  return (
    <Link
      to="/"
      search={shown === null ? {} : { creatrice: shown }}
      className={`nv-rail__agent${live !== null && several ? ' nv-rail__agent--named' : ''}`}
      data-tone={pill.tone}
      title={title}
      aria-label={title}
    >
      <span
        className={`nv-dot${pill.tone === 'unknown' ? '' : ` nv-tone--${pill.tone}`}${pill.live ? ' nv-dot--live' : ''}`}
        aria-hidden="true"
      />
      {/* Her name above, what runs under it (recette 27/11): a long state never cuts the name to one letter. A name
          wider than the pill is cut with « … », its title keeping it whole (recette 05/11, PRO-12). */}
      {live !== null && several ? (
        <span className="nv-rail__agent-text">
          <span className="nv-rail__agent-label">{live.creatorName}</span>
          <span className="nv-rail__agent-mode">{mode}</span>
        </span>
      ) : (
        <span className="nv-rail__agent-label">{label}</span>
      )}
    </Link>
  );
}
