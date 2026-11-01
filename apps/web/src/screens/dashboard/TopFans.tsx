import type { JSX } from 'react';

import { eur } from './logic';
import type { Fan } from './model';
import { Chevron, type FloatingTip } from './parts';

import { initialOf } from '@/lib/utils';

/**
 * Level 3: the best fans by what they spent, split agent / chatters. Each one opens his conversation in Suivi when the
 * account holds Suivi (DASH-14); otherwise the row is read only, nothing to click.
 */
export function TopFans({
  fans,
  tip,
  onOpen,
  usdNote,
}: {
  fans: readonly Fan[];
  tip: FloatingTip;
  onOpen: ((fan: Fan) => void) | undefined;
  /** How their dollars were counted, in one discreet sentence; absent when no dollar sale falls in the period. */
  usdNote?: string | undefined;
}): JSX.Element {
  const top = fans.filter((fan) => fan.spent > 0).slice(0, 4);
  const max = Math.max(1, ...top.map((fan) => fan.spent));
  const note = usdNote === undefined ? null : <p className="db-fans__note">{usdNote}</p>;
  if (top.length === 0) {
    return (
      <>
        <p className="db-pending nv-plate">Aucun achat observé sur la période.</p>
        {note}
      </>
    );
  }
  return (
    <>
      <div className="nv-plate db-fans">
        {top.map((fan) => {
          const row = (
            <>
              <span className="nv-avatar" aria-hidden="true">
                {initialOf(fan.name)}
              </span>
              <span className="db-fan__who">
                <span className="db-fan__name">{fan.name}</span>
                <span className="db-fan__line">{fan.line}</span>
              </span>
              {/* Every bar starts at the same place: widths are shares of the best fan's total. Data colours, not the
                neon: a fan's spend is no urgency (the agent's part takes the split's first colour). */}
              <span
                className="nv-split"
                {...tip.bind({
                  title: fan.name,
                  rows: [
                    ['Vendu par l’agent', eur(fan.byAgent)],
                    ['Vendu par un chatteur', eur(fan.spent - fan.byAgent)],
                  ],
                })}
              >
                <i className="nv-split__part" style={{ '--nv-w': `${String((fan.byAgent / max) * 100)}%` }} />
                <i
                  className="nv-split__part"
                  style={{
                    '--nv-w': `${String(((fan.spent - fan.byAgent) / max) * 100)}%`,
                    '--_c': 'var(--nv-data-2)',
                  }}
                />
              </span>
              <span className="db-fan__spent">{eur(fan.spent)}</span>
              {onOpen === undefined ? null : <Chevron className="db-chev" />}
            </>
          );
          return onOpen === undefined ? (
            <div key={fan.id} className="db-fan">
              {row}
            </div>
          ) : (
            <button
              key={fan.id}
              type="button"
              className="db-fan nv-tap"
              title="Ouvrir sa conversation dans Suivi"
              onClick={() => {
                onOpen(fan);
              }}
            >
              {row}
            </button>
          );
        })}
      </div>
      {note}
    </>
  );
}
