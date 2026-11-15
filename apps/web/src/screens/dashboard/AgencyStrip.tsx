import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { gaugeClass } from './logic';
import type { AgencyState } from './model';

/**
 * What is the agency's on her Dashboard, said once and apart from her agent's health (recette 05/11, reco 18): the
 * day's AI budget, counted for every creator, in one quiet line (amber past its alert, red at its cap). Nothing when
 * there is nothing to say. The same face as the other banners (ADM-26): a medallion, a title, a line, an action on the
 * right; on the agency's view its title alone says it is the agency's.
 */
export function AgencyStrip({
  agency,
  onAgencyView = false,
  opensSettings = false,
}: {
  agency: AgencyState;
  /** « Toute l'agence » is the view: « Pour toute l'agence » would say it twice. */
  onAgencyView?: boolean;
  /** The models and their budget are set in Réglages, the owner's alone. */
  opensSettings?: boolean;
}): JSX.Element | null {
  const { budget } = agency;
  if (budget === null) return null;
  return (
    <aside className="nv-plate db-agency nv-enter" data-tone={budget.tone} aria-labelledby="db-agency-title">
      <span className="db-orb" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
        </svg>
      </span>
      <div className="db-agency__body">
        {onAgencyView ? null : (
          <p className="db-agency__title" id="db-agency-title">
            Pour toute l’agence
          </p>
        )}
        <div className="db-agency__line">
          <span className="db-agency__label" {...(onAgencyView ? { id: 'db-agency-title' } : {})}>
            Budget IA du jour, toutes créatrices
          </span>
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
      </div>
      {opensSettings ? (
        <Link className="nv-btn nv-btn--soft nv-btn--sm db-banner__go" to="/reglages/modeles-ia">
          Voir les modèles IA
        </Link>
      ) : null}
    </aside>
  );
}
