import type { JSX } from 'react';

import { gaugeClass } from './logic';
import type { AgencyState } from './model';

/**
 * What is the agency's on her Dashboard, said once and apart from her agent's health (recette 05/11, reco 18): the
 * day's AI budget, counted for every creator, in one quiet line (amber past its alert, red at its cap). Nothing when
 * there is nothing to say.
 */
export function AgencyStrip({ agency }: { agency: AgencyState }): JSX.Element | null {
  const { budget } = agency;
  if (budget === null) return null;
  return (
    <aside className="nv-plate db-agency nv-enter" aria-labelledby="db-agency-title">
      <p id="db-agency-title" className="db-agency__title">
        Pour toute l’agence
      </p>
      <div className="db-agency__line" data-tone={budget.tone}>
        <span className={`nv-dot nv-tone--${budget.tone}`} aria-hidden="true" />
        <span className="db-agency__label">Budget IA du jour, toutes créatrices</span>
        <span className="db-agency__value nv-num">{budget.value}</span>
        <span
          className={`nv-gauge db-agency__gauge ${gaugeClass('spend', budget.gauge.value, budget.tone)}`}
          style={{
            '--nv-gauge-value': `${String(budget.gauge.value)}%`,
            '--nv-gauge-mark': `${String(budget.gauge.mark)}%`,
          }}
          role="img"
          aria-label={`${String(budget.gauge.value)} % du budget, alerte à ${String(budget.gauge.mark)} %`}
        >
          <span className="nv-gauge__fill" />
          <span className="nv-gauge__mark" />
        </span>
        <span className="db-agency__sub">{budget.sub}</span>
      </div>
    </aside>
  );
}
