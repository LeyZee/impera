import { owedReveals, type Me } from '@impera/contracts';
import { useEffect, useRef, useState, type JSX } from 'react';

import { RewardReveal } from './RewardReveal';
import { playsTheGame, useMarkRevealed, useMyTrophyCase, usePreferences } from './api';
import { heightOfKind, rankOfKind, revealWordsOf } from './reveal-words';

import { usePayPeriod } from '@/payroll/api';
import { tiersOf } from '@/screens/pay/MyFigures';
import { useCurrentPeriod } from '@/screens/pay/data';

/** How many other gains are shown under the ceremony, and how large: beyond, « +N » (three names hold at 390 px). */
const ALSO_SHOWN = 3;
const ALSO_SIZE = 44;

/**
 * Plays what a chatter is owed as ONE reveal an arrival (ADR 0104 § 12, recette CHT-09): mounted on Aujourd'hui and
 * on Commissions only, so it greets them as they arrive and never covers a conversation (Charles, 13/11). When
 * several gains are owed, the highest gets the ceremony (a rank, then a tier's medal, then a trophy, then a streak;
 * of two as high, the most recent) and the others are named under it, « Aussi gagné », with no ceremony of their
 * own. Several ranks owed at once (thresholds set over a history) are one gain: the highest. Closing it marks
 * everything owed as seen, and it plays once. Nothing here for a manager, the owner or a creator.
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
  const tiers = tiersOf(period);
  const drawn = waiting.map((item) => ({ item, words: revealWordsOf(item, current, tiers) }));
  // A kind this screen does not draw: seen without a show, so it never comes back.
  const unknown = drawn.filter((one) => one.words === null).map((one) => one.item.kind);
  // The ranks passed on the way to the highest are not gains to name beside it: they close with it.
  const topRank = Math.max(0, ...waiting.map((item) => rankOfKind(item.kind) ?? 0));
  const under = (kind: string): boolean => (rankOfKind(kind) ?? topRank) < topRank;
  // The highest first; of two as high, the most recent.
  const shown = drawn
    .filter((one) => one.words !== null && !under(one.item.kind))
    .toSorted(
      (a, b) =>
        heightOfKind(b.item.kind) - heightOfKind(a.item.kind) ||
        (b.item.earnedAt ?? '').localeCompare(a.item.earnedAt ?? ''),
    );
  const first = shown[0]?.item.kind;
  const words = shown[0]?.words ?? null;
  const others = shown.slice(1);
  const also = others.slice(0, ALSO_SHOWN).flatMap((one) => {
    const small = revealWordsOf(one.item, current, tiers, ALSO_SIZE);
    return small === null ? [] : [{ key: one.item.kind, object: small.object, name: small.title }];
  });
  const close = (): void => {
    // « Continuer » is also a tap on the reveal: it closes once, and everything owed is seen with it.
    if (first === undefined || closed.current.has(first)) return;
    closed.current.add(first);
    const kinds = [first, ...waiting.map((item) => item.kind).filter((kind) => kind !== first)];
    setSeen((before) => [...before, ...kinds]);
    mark(kinds);
  };
  const skipped = unknown.join(' ');
  const skip = useRef(mark);
  skip.current = mark;
  useEffect(() => {
    // Only when nothing drawn is waiting: otherwise they are marked with it, as it closes.
    if (skipped === '' || first !== undefined) return;
    const kinds = skipped.split(' ');
    setSeen((before) => [...before, ...kinds]);
    skip.current(kinds);
  }, [skipped, first]);

  if (first === undefined || words === null) return null;
  return (
    <RewardReveal
      key={first}
      {...words}
      also={also}
      more={others.length - also.length}
      sound={preferences.sounds}
      onClose={close}
    />
  );
}
