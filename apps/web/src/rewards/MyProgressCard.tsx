import type { Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { GameGauge } from './GameGauge';
import { LevelInsignia } from './LevelInsignia';
import { rankPercent } from './MyRankCard';
import { playsTheGame, useMyTrophyCase } from './api';
import './rewards.css';

import { Panel } from '@/shell/layout';

const shifts = (count: number): string => `${String(count)} ${count > 1 ? 'shifts' : 'shift'}`;

/**
 * Aujourd'hui › « Ma progression » (ADR 0134, lot 1): where the chatter stands in the game, in one glance, and the way
 * to Moi › Trophées, the whole card being the link. His rank, the way to the one ahead as a gauge and his series under
 * way: no amount here, they are on « Mon rang » and in his trophies. Nothing shows while there is nothing to say (no
 * rank set by the owner and no series), nor for who does not play.
 */
export function MyProgressCard({ user }: { user: Me }): JSX.Element | null {
  const trophyCase = useMyTrophyCase(playsTheGame(user)).data;
  if (trophyCase === undefined) return null;
  const { level } = trophyCase;
  const nextLevel = trophyCase.nextLevel ?? null;
  const streak = trophyCase.streaks.find((each) => each.kind === 'shift') ?? null;
  const running = streak !== null && streak.current > 0;
  if (level === null && nextLevel === null && !running) return null;
  const ranked = level !== null || nextLevel !== null;
  return (
    <Panel className="rw-progress sc-linked nv-enter" eyebrow="Ma progression">
      <Link to="/moi/trophees" className="sc-card-link" aria-label="Voir mes trophées" />
      <div className="rw-progress__body">
        {ranked ? <LevelInsignia rank={level?.rank ?? 1} earned={level !== null} size={56} /> : null}
        <div className="rw-progress__main">
          {ranked ? (
            <p className="rw-progress__name">{level === null ? 'Pas encore de rang' : level.name}</p>
          ) : null}
          {nextLevel === null ? null : (
            <>
              <GameGauge
                userId={user.id}
                name="today-rank"
                scope={String(nextLevel.rank)}
                percent={rankPercent(nextLevel)}
                label={`Avancée vers le rang ${nextLevel.name}`}
                className="rw-rank__gauge rw-progress__gauge"
              />
              <p className="rw-progress__line">
                {level === null ? 'Premier rang' : 'Rang suivant'}&nbsp;: <b>{nextLevel.name}</b>
              </p>
            </>
          )}
          {running ? (
            <p className="rw-progress__line nv-num">
              Série en cours&nbsp;: <b>{shifts(streak.current)}</b>
            </p>
          ) : null}
        </div>
        <span className="rw-progress__go" aria-hidden="true">
          Mes trophées
          <svg viewBox="0 0 16 16" focusable="false">
            <path d="M6 3.5 10.5 8 6 12.5" />
          </svg>
        </span>
      </div>
    </Panel>
  );
}
