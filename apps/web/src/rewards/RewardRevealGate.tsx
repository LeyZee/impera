import { owedReveals, type Me } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { RewardReveal } from './RewardReveal';
import { playsTheGame, useMarkRevealed, useMyTrophyCase, usePreferences } from './api';
import { revealWordsOf } from './reveal-words';

import { usePayPeriod } from '@/payroll/api';
import { tiersOf } from '@/screens/pay/MyFigures';
import { useCurrentPeriod } from '@/screens/pay/data';

/**
 * Plays the reveals a chatter is owed, one at a time, the oldest first (ADR 0104 § 12): mounted on Aujourd'hui and on
 * Commissions only, so a reveal greets them as they arrive and never covers a conversation (Charles, 13/11). Each is
 * marked seen as it closes, and plays once. Nothing here for a manager, the owner or a creator.
 */
export function RewardRevealGate({ user }: { user: Me }): JSX.Element | null {
  const plays = playsTheGame(user);
  const trophyCase = useMyTrophyCase(plays).data;
  const mark = useMarkRevealed();
  const { preferences } = usePreferences(user);
  const current = useCurrentPeriod();
  const period = usePayPeriod(plays ? current : null).data;
  // What was closed here, until the server's answer says so too: a closed reveal never flashes back.
  const [seen, setSeen] = useState<readonly string[]>([]);
  const closed = useRef(new Set<string>());

  const owed =
    !plays || trophyCase === undefined
      ? []
      : owedReveals(trophyCase).filter((item) => !seen.includes(item.kind));
  const first = owed[0]?.kind;
  const words = owed[0] === undefined ? null : revealWordsOf(owed[0], current, tiersOf(period));
  const close = (): void => {
    // « Continuer » is also a tap on the reveal: it closes once.
    if (first === undefined || closed.current.has(first)) return;
    closed.current.add(first);
    setSeen((before) => [...before, first]);
    mark([first]);
  };
  // A kind this screen does not draw: seen without a show, so it never blocks the ones behind it.
  const unknown = first !== undefined && words === null;
  const skip = useRef(close);
  skip.current = close;
  useEffect(() => {
    if (unknown) skip.current();
  }, [unknown, first]);

  if (first === undefined || words === null) return null;
  return <RewardReveal key={first} {...words} sound={preferences.sounds} onClose={close} />;
}
