import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { pillOf } from '@/agent/mode';
import { useAgentMode } from '@/agent/useAgentMode';
import { useCreators } from '@/creators/api';

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
  const view = useAgentMode();
  const live = view.source === 'live' ? view : null;
  const stalled = live?.stalled ?? null;
  const pill = pillOf(live?.mode ?? null, stalled === null);
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
    <Link to="/" className="nv-rail__agent" data-tone={pill.tone} title={title} aria-label={title}>
      <span
        className={`nv-dot${pill.tone === 'unknown' ? '' : ` nv-tone--${pill.tone}`}${pill.live ? ' nv-dot--live' : ''}`}
        aria-hidden="true"
      />
      {label}
    </Link>
  );
}
