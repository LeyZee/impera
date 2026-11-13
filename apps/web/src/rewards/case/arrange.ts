import type { TrophyCase, TrophyCaseFamily, TrophyCaseItem, TrophyCaseProgress } from '@impera/contracts';

/*
 * How the trophy case lays out what the server says (ADR 0108 § 3, 4, 6, 7): the next trophy on top, then three
 * shelves in a fixed order, the earned objects first. Nothing here works out a fact: every count comes from the
 * server, this only sorts and rounds it.
 */

/** The shelves, always in this order (ADR 0108 § 4). */
export const SHELF_ORDER: readonly TrophyCaseFamily[] = ['medal', 'streak', 'trophy'];

/**
 * How far along, in whole percent, rounded down: 9 shifts out of 10 is 90 %, and an object never shows 100 % before
 * it is earned (ADR 0108 § 7). `null` when the object has no count.
 */
export function percentOf(progress: TrophyCaseProgress | null, earned: boolean): number | null {
  if (earned) return 100;
  if (progress === null) return null;
  const share = Math.floor((progress.current * 100) / progress.target);
  return Math.max(0, Math.min(99, share));
}

const isEarned = (item: TrophyCaseItem): boolean => item.earnedAt !== null;

/** Earned first, most recent first; then the ones ahead, most advanced first, those without a count last. */
function byShelfOrder(a: TrophyCaseItem, b: TrophyCaseItem): number {
  if (isEarned(a) !== isEarned(b)) return isEarned(a) ? -1 : 1;
  if (isEarned(a)) return (b.earnedAt ?? '').localeCompare(a.earnedAt ?? '');
  return (percentOf(b.progress, false) ?? -1) - (percentOf(a.progress, false) ?? -1);
}

export interface Shelf {
  readonly family: TrophyCaseFamily;
  readonly items: readonly TrophyCaseItem[];
  readonly earned: number;
}

/** The three shelves, an empty one left out. The sort is stable: the server's order breaks a tie. */
export function shelvesOf(trophyCase: TrophyCase): Shelf[] {
  return SHELF_ORDER.map((family) => {
    const items = trophyCase.items.filter((item) => item.family === family).toSorted(byShelfOrder);
    return { family, items, earned: items.filter(isEarned).length };
  }).filter((shelf) => shelf.items.length > 0);
}

/**
 * The next trophy (ADR 0108 § 3): of the objects ahead that have a count, the most advanced; on a tie, the one with
 * the least left to do. `null` when none has a count.
 */
export function nextTrophy(trophyCase: TrophyCase): TrophyCaseItem | null {
  let best: TrophyCaseItem | null = null;
  for (const item of trophyCase.items) {
    if (isEarned(item) || item.progress === null) continue;
    if (best === null) {
      best = item;
      continue;
    }
    const gap = (percentOf(item.progress, false) ?? 0) - (percentOf(best.progress, false) ?? 0);
    const left = (one: TrophyCaseItem): number =>
      one.progress ? one.progress.target - one.progress.current : 0;
    if (gap > 0 || (gap === 0 && left(item) < left(best))) best = item;
  }
  return best;
}

/** On a phone, a shelf shows what was earned and the next object only; the rest waits behind « Voir tout ». */
export function foldedShelf(shelf: Shelf): { shown: readonly TrophyCaseItem[]; hidden: number } {
  const shown = [
    ...shelf.items.filter(isEarned),
    ...shelf.items.filter((item) => !isEarned(item)).slice(0, 1),
  ];
  return { shown, hidden: shelf.items.length - shown.length };
}

export const earnedCount = (trophyCase: TrophyCase): number => trophyCase.items.filter(isEarned).length;
