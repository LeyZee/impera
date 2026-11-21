import { funnelSteps } from '@impera/design-system';
import type { JSX } from 'react';

import { signed } from './logic';
import { CountUp, type FloatingTip } from './parts';

/** One step of a path, in the trade's words, with what it means. */
export interface FunnelLabel {
  readonly name: string;
  readonly hint: string;
  readonly meaning: string;
}

/** The agent's path of a fan on a creator's Dashboard, shown once Reveal's purchases are observed. */
export const AGENT_PATH: readonly FunnelLabel[] = [
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
  labels,
  counts,
  before,
  breakNote = 'La plus forte baisse de la période : c’est ici qu’il faut lire les conversations.',
  colours,
  soft = false,
  tip,
}: {
  labels: readonly FunnelLabel[];
  counts: readonly number[];
  /** Absent: no comparison, so no step is flagged. */
  before?: readonly number[];
  breakNote?: string;
  /** One colour per step (series tokens); absent, the design system's ink. */
  colours?: readonly string[];
  /**
   * Widths on a square-root scale: a path that falls from thousands to tens keeps its last steps apart (38 against
   * 14 stays readable). The counts and rates are untouched.
   */
  soft?: boolean;
  tip: FloatingTip;
}): JSX.Element {
  const { steps, breakIndex } = funnelSteps(counts, before);
  return (
    <div className="nv-funnel nv-plate db-funnel">
      {steps.map((step, i) => {
        const label = labels[i];
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
            style={colours?.[i] === undefined ? { '--nv-i': i } : { '--nv-i': i, '--_step': colours[i] }}
            tabIndex={0}
            {...tip.bind({
              title: label?.name ?? '',
              text: label?.meaning ?? '',
              rows,
              ...(broke ? { note: breakNote } : {}),
            })}
          >
            <span className="nv-funnel__label">
              <span className="nv-funnel__name">{label?.name}</span>
              <span className="nv-funnel__hint">{label?.hint}</span>
            </span>
            <span
              className="nv-funnel__track"
              style={{
                '--nv-w': `${String(step.count > 0 ? Math.max(soft ? Math.sqrt(step.width / 100) * 100 : step.width, 3) : 0)}%`,
              }}
            >
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
