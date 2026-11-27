import type { JSX } from 'react';

import { useAgentMode } from '@/agent/useAgentMode';

/**
 * On the phone's bar, a red dot on the Dashboard's tab while the AI's read of Reveal is cut (27/11/2026): the bar there
 * has no « Agent » pill, the dot says it on every screen. Still, without a word; the Dashboard says the rest.
 */
export function RevealCutMark(): JSX.Element | null {
  const view = useAgentMode();
  if (view.source !== 'live' || view.reveal !== 'cut' || view.mode === 'stop') return null;
  return (
    <span className="nv-rail__cut nv-dot nv-tone--bad" role="img" aria-label="Lecture de Reveal coupée" />
  );
}
