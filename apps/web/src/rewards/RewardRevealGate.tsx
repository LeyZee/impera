import { owedReveals, type Me } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { RewardReveal } from './RewardReveal';
import { playsTheGame, useMarkRevealed, useMyTrophyCase, usePreferences } from './api';
import { rankOfKind, revealWordsOf } from './reveal-words';

import { usePayPeriod } from '@/payroll/api';
import { tiersOf } from '@/screens/pay/MyFigures';
import { useCurrentPeriod } from '@/screens/pay/data';

/**
 * Plays the reveals a chatter is owed, one at a time, the oldest first (ADR 0104 § 12): mounted on Aujourd'hui and on
 * Commissions only, so a reveal greets them as they arrive and never covers a conversation (Charles, 13/11). Each is
 * marked seen as it closes, and plays once. Several ranks owed at once (thresholds set over a history) play as one:
 * the highest, which marks the ones under it seen with it (recette CHT-09). Nothing here for a manager, the owner or
 * a creator.
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

  const waiting =
    !plays || trophyCase === undefined
      ? []
      : owedReveals(trophyCase).filter((item) => !seen.includes(item.kind));
  const topRank = Math.max(0, ...waiting.map((item) => rankOfKind(item.kind) ?? 0));
  const under = (kind: string): boolean => (rankOfKind(kind) ?? topRank) < topRank;
  const owed = waiting.filter((item) => !under(item.kind));
  const first = owed[0]?.kind;
  const words = owed[0] === undefined ? null : revealWordsOf(owed[0], current, tiersOf(period));
  const close = (): void => {
    // « Continuer » is also a tap on the reveal: it closes once.
    if (first === undefined || closed.current.has(first)) return;
    closed.current.add(first);
    // The highest rank closes the ranks passed on the way to it.
    const kinds =
      rankOfKind(first) === null
        ? [first]
        : [first, ...waiting.filter((item) => under(item.kind)).map((item) => item.kind)];
    setSeen((before) => [...before, ...kinds]);
    mark(kinds);
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
