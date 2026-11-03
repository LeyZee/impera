import { funnelSteps } from '@impera/design-system';
import type { JSX } from 'react';

import { signed } from './logic';
import { CountUp, type FloatingTip } from './parts';

/** The steps of the fans' path, in the trade's words, with what each one means. */
const STEPS: readonly { readonly name: string; readonly hint: string; readonly meaning: string }[] = [
  { name: 'Nouveaux fans', hint: 'abonnés sur la période', meaning: 'Tous les fans arrivés sur la période.' },
  {
    name: 'Fan connu',
    hint: 'prénom, âge, métier, ville notés',
    meaning: 'Les infos de base sont notées dans les notes client Reveal.',
  },
  {
    name: 'Conversation chaude',
    hint: 'la conversation est sexualisée',
    meaning: 'Le fan a sexualisé, ou l’agent l’a fait après le délai réglé.',
  },
  {
    name: '1re offre envoyée',
    hint: 'un script Reveal proposé',
    meaning: 'Repère du corpus : vers 2 h 30 après le premier message.',
  },
  { name: 'Achat', hint: 'la 1re offre est payée', meaning: 'La 1re offre fait 75 % des ventes du corpus.' },
];

const formatCount = (value: number): string => String(Math.round(value));

/** Level 2 bis: where the agent loses fans. The step that fell the most against the period before is amber. */
export function FunnelPanel({
  counts,
  before,
  tip,
}: {
  counts: readonly number[];
  before: readonly number[];
  tip: FloatingTip;
}): JSX.Element {
  const { steps, breakIndex } = funnelSteps(counts, before);
  return (
    <div className="nv-funnel nv-plate db-funnel">
      {steps.map((step, i) => {
        const label = STEPS[i];
        const previous = steps[i - 1];
        const broke = i === breakIndex;
        const rows: [string, string][] = [];
        if (step.rate !== null && previous !== undefined) {
          rows.push(['Passent à cette étape', `${String(step.count)} sur ${String(previous.count)}`]);
          rows.push(['Taux', `${String(step.rate)} %`]);
          if (step.delta !== null) rows.push(['Période d’avant', `${String(step.rate - step.delta)} %`]);
        }
        return (
          <div
            key={label?.name ?? i}
            className={`nv-funnel__step${broke ? ' nv-funnel__step--break' : ''}`}
            style={{ '--nv-i': i }}
            tabIndex={0}
            {...tip.bind({
              title: label?.name ?? '',
              text: label?.meaning ?? '',
              rows,
              ...(broke
                ? {
                    note: 'La plus forte baisse de la période : c’est ici qu’il faut lire les conversations.',
                  }
                : {}),
            })}
          >
            <span className="nv-funnel__label">
              <span className="nv-funnel__name">{label?.name}</span>
              <span className="nv-funnel__hint">{label?.hint}</span>
            </span>
            <span className="nv-funnel__track" style={{ '--nv-w': `${String(step.width)}%` }}>
              <span className="nv-funnel__bar" />
              {broke ? <span className="nv-funnel__flag">Ça casse ici</span> : null}
            </span>
            <CountUp className="nv-funnel__count" value={step.count} format={formatCount} />
            <span className="nv-funnel__rate">
              {step.rate === null ? null : (
                <>
                  {step.rate} %
                  {step.delta === null ? null : (
                    <span className={`nv-delta nv-delta--${step.delta >= 0 ? 'better' : 'worse'}`}>
                      {signed(step.delta)} {Math.abs(step.delta) > 1 ? 'pts' : 'pt'}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
