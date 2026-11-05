import type { CreatorId } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { useCreatorAccount, usePersonaVersionCount } from './api';
import { useAgencyRates } from './rate/api';
import { creatorsSearch } from './search';
import { isSetUp, setupSteps } from './setup';
import './setup.css';

import { cityOf } from '@/scheduling/time';

/**
 * « Pour démarrer avec Aurore » (CRM-07 b2): at the top of her sheet, for the owner, what is left to set up, each step
 * opening its tab; her zone said beside it, Paris for a creator the import made (ADR 0069 § 3). Gone once all is done.
 * Quiet: a step to do is not a fault, and a read that fails shows no card rather than a wrong one, each tab saying it.
 */
export function SetupCard({
  creatorId,
  creatorName,
  timezone,
}: {
  creatorId: CreatorId;
  creatorName: string;
  timezone: string;
}): JSX.Element | null {
  const persona = usePersonaVersionCount(creatorId);
  const rates = useAgencyRates(creatorId);
  const account = useCreatorAccount(creatorId);
  if (persona.data === undefined || rates.data === undefined || account.data === undefined) return null;
  const steps = setupSteps({
    personaVersions: persona.data,
    hasRate: rates.data.current !== null,
    account: account.data,
  });
  if (isSetUp(steps)) return null;
  const done = steps.filter((step) => step.state === 'done').length;
  return (
    <section className="nv-plate cr-setup nv-enter" aria-labelledby="cr-setup-title">
      <header className="cr-setup__head">
        <h2 id="cr-setup-title" className="cr-setup__title">
          Pour démarrer avec {creatorName}
        </h2>
        <span className="cr-setup__count nv-num">
          {done} sur {steps.length}
        </span>
      </header>
      <ul className="cr-setup__steps">
        {steps.map((step) => (
          <li key={step.sheet} className="cr-setup__step" data-state={step.state}>
            <span className="cr-setup__mark" aria-hidden="true">
              {step.state === 'done' ? (
                <svg viewBox="0 0 16 16">
                  <path d="m4 8.5 2.5 2.5L12 5.5" />
                </svg>
              ) : null}
            </span>
            <span className="cr-setup__text">
              <span className="cr-setup__label">
                {step.label}
                {step.state === 'done' ? <span className="sr-only"> : fait</span> : null}
              </span>
              {step.state === 'done' ? null : <span className="cr-setup__hint">{step.hint}</span>}
            </span>
            {step.state === 'done' ? null : (
              <Link
                to="/creatrices"
                search={creatorsSearch(step.sheet, creatorId)}
                className="nv-btn nv-btn--soft nv-btn--sm"
                aria-label={`Ouvrir : ${step.label}`}
              >
                Ouvrir
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="cr-setup__zone">
        Ses heures se lisent à l’heure de {cityOf(timezone)}.{' '}
        <Link to="/creatrices" search={creatorsSearch('hours', creatorId)} className="cr-setup__link">
          Changer
        </Link>
      </p>
    </section>
  );
}
