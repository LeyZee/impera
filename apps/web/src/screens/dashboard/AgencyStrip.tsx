import type { JSX } from 'react';

import { gaugeClass } from './logic';
import type { AgencyState } from './model';

/**
 * What is the agency's on her Dashboard, said once and apart from her agent's health (recette 05/11, reco 18 and
 * PRO-10): the day's AI budget, counted for every creator, in one quiet line (amber past its alert, red at its cap),
 * and for the owner only, the stuck jobs of no creator, each by its name and what it holds back. Nothing when there is
 * nothing to say.
 */
export function AgencyStrip({
  agency,
  forOwner,
}: {
  agency: AgencyState;
  forOwner: boolean;
}): JSX.Element | null {
  const stuck = forOwner ? agency.stuck : [];
  const { budget } = agency;
  if (budget === null && stuck.length === 0) return null;
  return (
    <aside className="nv-plate db-agency nv-enter" aria-labelledby="db-agency-title">
      <p id="db-agency-title" className="db-agency__title">
        Pour toute l’agence
      </p>
      {budget === null ? null : (
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
      )}
      {stuck.map((job) => (
        <div key={job.task} className="db-agency__line" data-tone="warn" title={job.task}>
          <span className="nv-dot nv-tone--warn" aria-hidden="true" />
          <span className="db-agency__label">
            {job.name} : {job.count > 1 ? `${String(job.count)} tâches bloquées` : 'bloquée'}
          </span>
          <span className="db-agency__sub">{job.effect}</span>
        </div>
      ))}
    </aside>
  );
}
