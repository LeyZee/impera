import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { LevelInsignia } from './LevelInsignia';
import { playsTheGame, useMyTrophyCase } from './api';
import './rewards.css';

import { amountText } from '@/reports/model';
import { Panel } from '@/shell/layout';

/**
 * Commissions › « Mon rang » (ADR 0104 § 16): the rank the chatter holds and the way to the one ahead, on their own
 * cumulated net. Honorary: no rate, tier or right hangs on it, and the card says so. Nothing shows while the owner
 * has set no threshold. The insignia is gold because it is earned; the way to the next one is the blue of a progress.
 */
export function MyRankCard({ user }: { user: Me }): JSX.Element | null {
  const trophyCase = useMyTrophyCase(playsTheGame(user)).data;
  if (trophyCase === undefined) return null;
  const { level } = trophyCase;
  const nextLevel = trophyCase.nextLevel ?? null;
  if (level === null && nextLevel === null) return null;
  const percent =
    nextLevel === null ? 100 : Math.round((nextLevel.currentMinor / nextLevel.thresholdMinor) * 100);
  return (
    <Panel className="nv-enter rw-rank" eyebrow="Mon rang">
      <div className="rw-rank__body">
        <LevelInsignia rank={level?.rank ?? 1} earned={level !== null} size={72} />
        <div className="rw-rank__main">
          <p className="rw-rank__name">{level === null ? 'Pas encore de rang' : level.name}</p>
          {nextLevel === null ? (
            <p className="rw-rank__note">Le plus haut rang ouvert. Il ne redescend jamais.</p>
          ) : (
            <>
              <p className="rw-rank__next nv-num">
                {level === null ? 'Premier rang' : 'Rang suivant'} : <b>{nextLevel.name}</b> à{' '}
                {amountText(nextLevel.thresholdMinor, nextLevel.currency)} de net cumulé
              </p>
              <div
                className="nv-gauge rw-rank__gauge"
                role="progressbar"
                aria-label={`Avancée vers le rang ${nextLevel.name}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                style={{ '--nv-gauge-value': `${String(percent)}%` }}
              >
                <span className="nv-gauge__fill" />
              </div>
              <p className="rw-rank__note nv-num">
                {amountText(nextLevel.currentMinor, nextLevel.currency)} à ce jour. Un rang est honorifique :
                il ne change ni ton taux ni ta paie, et ne redescend jamais.
              </p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
