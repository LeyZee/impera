import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { GameGauge } from './GameGauge';
import { LevelInsignia } from './LevelInsignia';
import { playsTheGame, useMyTrophyCase } from './api';
import './rewards.css';

import { amountText } from '@/reports/model';
import { Panel } from '@/shell/layout';

/**
 * How far the net is on the way to the next rank, from 0 to 99: the bar is never full before the rank is noted, even
 * when the net has passed the threshold and the job has not run yet (recette CHT-08).
 */
export const rankPercent = (next: {
  readonly currentMinor: number;
  readonly thresholdMinor: number;
}): number => Math.min(99, Math.max(0, Math.floor((next.currentMinor / next.thresholdMinor) * 100)));

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
  const percent = nextLevel === null ? 100 : rankPercent(nextLevel);
  return (
    <Panel className="nv-enter rw-rank" eyebrow="Mon rang">
      <div className="rw-rank__body">
        <LevelInsignia rank={level?.rank ?? 1} earned={level !== null} size={72} />
        <div className="rw-rank__main">
          <p className="rw-rank__name">{level === null ? 'Pas encore de rang' : level.name}</p>
          {nextLevel === null ? (
            <p className="rw-rank__note">Le plus haut rang ouvert. Il suit ton net cumulé.</p>
          ) : (
            <>
              <p className="rw-rank__next nv-num">
                {level === null ? 'Premier rang' : 'Rang suivant'}&nbsp;: <b>{nextLevel.name}</b> à{' '}
                {amountText(nextLevel.thresholdMinor, nextLevel.currency)} de net cumulé
              </p>
              <GameGauge
                userId={user.id}
                name="rank"
                scope={String(nextLevel.rank)}
                percent={percent}
                label={`Avancée vers le rang ${nextLevel.name}`}
                className="rw-rank__gauge"
              />
              <p className="rw-rank__note nv-num">
                {amountText(nextLevel.currentMinor, nextLevel.currency)} de net à ce jour. Honorifique&nbsp;:
                ni ton taux ni ta paie n’en dépendent. Il redescend si une vente est remboursée ou un rapport
                corrigé.
              </p>
            </>
          )}
        </div>
      </div>
    </Panel>
  );
}
