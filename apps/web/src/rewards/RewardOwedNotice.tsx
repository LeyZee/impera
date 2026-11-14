import { owedReveals, type Me } from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { playsTheGame, useMyTrophyCase } from './api';

/** Where a reveal plays by itself (`RewardRevealGate`): the notice has nothing to say there. */
const REVEAL_SCREENS = ['/aujourdhui', '/commissions'] as const;

const isRevealScreen = (pathname: string): boolean =>
  REVEAL_SCREENS.some((screen) => pathname === screen || pathname === `${screen}/`);

/**
 * A gain noted while the chatter is elsewhere, on a conversation above all: a small notice says so and « Voir » takes
 * them to Aujourd'hui, where the reveal plays. Nothing moves, nothing sounds, nothing covers the screen (ADR 0104
 * § 12 ; Charles, 13/11 : « à l'arrivée, jamais sur un fan »). The region is always there, empty when silent.
 */
export function RewardOwedNotice({ user, pathname }: { user: Me; pathname: string }): JSX.Element {
  const plays = playsTheGame(user);
  const trophyCase = useMyTrophyCase(plays).data;
  const owed = trophyCase === undefined ? 0 : owedReveals(trophyCase).length;
  return (
    <div className="rw-owed-region" role="status">
      {plays && owed > 0 && !isRevealScreen(pathname) ? (
        <p className="rw-owed nv-glass nv-glass--thick">
          <span className="rw-owed__dot" aria-hidden="true" />
          <span>{owed === 1 ? 'Un gain t’attend.' : `${String(owed)} gains t’attendent.`}</span>
          <Link to="/aujourdhui" className="nv-btn nv-btn--soft nv-btn--sm">
            Voir
          </Link>
        </p>
      ) : null}
    </div>
  );
}
