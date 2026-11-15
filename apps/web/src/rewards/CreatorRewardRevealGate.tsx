import { owedReveals, type Me } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { RewardReveal } from './RewardReveal';
import { useHerTrophyCase, useMarkHerRevealed, usePreferences } from './api';
import { creatorRevealWordsOf } from './creator-art';

/**
 * Plays the reveals a creator is owed, one at a time, the oldest first, three at most in a row (ADR 0107 § 11): mounted
 * on her Aujourd'hui, Agenda and Contenu, never on a conversation. Each is marked seen as it closes, and plays once;
 * past the third, the rest are marked seen with it and wait in her showcase. The reveal is the chatter's, its object and words hers.
 */
const AT_MOST_IN_A_ROW = 3;

export function CreatorRewardRevealGate({ user }: { user: Me }): JSX.Element | null {
  const plays = user.role === 'creator';
  const trophyCase = useHerTrophyCase(plays).data;
  const mark = useMarkHerRevealed();
  const { preferences } = usePreferences(user);
  // What was closed here, until the server's answer says so too: a closed reveal never flashes back.
  const [seen, setSeen] = useState<readonly string[]>([]);
  const closed = useRef(new Set<string>());

  const owed =
    !plays || trophyCase === undefined
      ? []
      : owedReveals(trophyCase).filter((item) => !seen.includes(item.kind));
  const first = owed[0]?.kind;
  const words = owed[0] === undefined ? null : creatorRevealWordsOf(owed[0]);
  const close = (): void => {
    if (first === undefined || closed.current.has(first)) return;
    closed.current.add(first);
    // The third closes the row: what is still owed waits in her showcase, marked seen without a show.
    const rest = seen.length + 1 >= AT_MOST_IN_A_ROW ? owed.slice(1).map((item) => item.kind) : [];
    setSeen((before) => [...before, first, ...rest]);
    mark([first, ...rest]);
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
