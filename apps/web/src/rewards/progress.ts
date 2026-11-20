import type { TrophyCase, TrophyCaseProgress } from '@impera/contracts';

import { TROPHY_NAMES, type TrophyKind } from './TrophyBadge';

/*
 * « Ma progression » on Aujourd'hui: which objects still ahead the chatter is closest to. The nearer a goal, the more
 * it pulls: the card shows the nearest first and says what is left in the goal's own unit. Only what the server
 * counts is shown; an amount stays on his statement and reads here as a share.
 */

export interface Goal {
  readonly kind: TrophyKind;
  readonly name: string;
  readonly current: number;
  readonly target: number;
  /** From 0 to 99: a goal still ahead is never drawn full. */
  readonly percent: number;
  /** What is left, in words: « Encore 1 shift », « 72 % ». */
  readonly left: string;
  /** Close enough to say so (four fifths of the way). */
  readonly near: boolean;
  /** Few enough steps to draw one by one. */
  readonly steps: number | null;
}

const UNITS: Readonly<
  Record<Exclude<TrophyCaseProgress['unit'], 'cents' | 'once'>, readonly [string, string]>
> = {
  shift: ['shift', 'shifts'],
  day: ['jour', 'jours'],
  delivery: ['livraison', 'livraisons'],
  category: ['catégorie', 'catégories'],
};

const isTrophy = (kind: string): kind is TrophyKind => Object.hasOwn(TROPHY_NAMES, kind);

const leftOf = (progress: TrophyCaseProgress, percent: number): string => {
  if (progress.unit === 'cents' || progress.unit === 'once') return `${String(percent)} %`;
  const missing = Math.max(1, progress.target - progress.current);
  const [one, many] = UNITS[progress.unit];
  return `Encore ${String(missing)} ${missing > 1 ? many : one}`;
};

/** The goals still ahead that have a count, the nearest first, `max` at most. */
export function nextGoals(trophyCase: TrophyCase, max = 3): readonly Goal[] {
  return trophyCase.items
    .flatMap((item): Goal[] => {
      const { progress } = item;
      if (item.earnedAt !== null || progress === null || progress.unit === 'once' || !isTrophy(item.kind))
        return [];
      const percent = Math.min(99, Math.max(0, Math.floor((progress.current / progress.target) * 100)));
      return [
        {
          kind: item.kind,
          name: TROPHY_NAMES[item.kind],
          current: Math.min(progress.current, progress.target),
          target: progress.target,
          percent,
          left: leftOf(progress, percent),
          near: percent >= 80,
          steps: progress.unit !== 'cents' && progress.target <= 10 ? progress.target : null,
        },
      ];
    })
    .toSorted((a, b) => b.percent - a.percent)
    .slice(0, max);
}
