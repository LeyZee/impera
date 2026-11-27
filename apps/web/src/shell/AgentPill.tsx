import { Link, useRouterState } from '@tanstack/react-router';
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
  const base = pillOf(live?.mode ?? null, stalled === null);
  // The read of Reveal says itself in the bar of every screen (27/11/2026): cut in red, late in amber, the mode after.
  const reveal = live?.mode === 'stop' ? 'ok' : (live?.reveal ?? 'ok');
  const pill =
    reveal === 'cut'
      ? { label: 'Reveal coupé', tone: 'bad' as const, live: false }
      : reveal === 'late'
        ? { label: 'Reveal en retard', tone: 'warn' as const, live: false }
        : base;
  const several = (useCreators().data?.length ?? 0) >= 2;
  const mode = view.source === 'loading' ? '…' : view.source === 'empty' ? 'Sans créatrice' : pill.label;
  const label = live !== null && several ? `${live.creatorName} · ${mode}` : mode;
  // The title keeps the mode the pill gives up to the read of Reveal.
  const modeName = live !== null && several ? `${live.creatorName} · ${base.label}` : base.label;
  const title =
    view.source === 'loading'
      ? 'Agent : lecture en cours.'
      : view.source === 'unavailable' || view.source === 'empty'
        ? TITLE[view.source]
        : reveal === 'cut'
          ? `Agent : ${modeName}. La lecture de Reveal est coupée : l’IA ne lit plus les fans. Voir le Dashboard.`
          : reveal === 'late'
            ? `Agent : ${modeName}. Reveal est lu avec du retard. Voir le Dashboard.`
            : stalled !== null && live?.mode !== 'stop'
              ? `Agent : ${label}, mais rien ne tourne : ${stalled}. Voir le Dashboard.`
              : `Agent : ${label}. Le changer sur le Dashboard.`;
  return (
    <Link
      to="/"
      search={shown === null ? {} : { creatrice: shown }}
      className="nv-rail__agent"
      data-tone={pill.tone}
      data-reveal={reveal === 'cut' ? 'cut' : undefined}
      title={title}
      aria-label={title}
    >
      {/* Running, the dot beats once at each read of Reveal (Charles, 27/11/2026), never in a loop. */}
      <span className={`nv-dot${pill.tone === 'unknown' ? '' : ` nv-tone--${pill.tone}`}`} aria-hidden="true">
        {pill.live && live?.lastReadAt != null ? (
          <span key={live.lastReadAt} className="nv-rail__beat" />
        ) : null}
      </span>
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
