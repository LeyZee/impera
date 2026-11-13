import { owedReveals, type Me } from '@impera/contracts';
import { useRef, useState, type JSX } from 'react';

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

  if (!plays || trophyCase === undefined) return null;
  const owed = owedReveals(trophyCase).filter((item) => !seen.includes(item.kind));
  const [first] = owed;
  if (first === undefined) return null;
  const words = revealWordsOf(first, current, tiersOf(period));
  const close = (): void => {
    // « Continuer » is also a tap on the reveal: it closes once.
    if (closed.current.has(first.kind)) return;
    closed.current.add(first.kind);
    setSeen((before) => [...before, first.kind]);
    mark([first.kind]);
  };
  if (words === null) {
    // A kind this screen does not draw: seen without a show, so it never blocks the ones behind it.
    queueMicrotask(close);
    return null;
  }
  return <RewardReveal key={first.kind} {...words} sound={preferences.sounds} onClose={close} />;
}
