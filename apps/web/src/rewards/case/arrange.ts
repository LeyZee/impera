import type { TrophyCase, TrophyCaseFamily, TrophyCaseItem, TrophyCaseProgress } from '@impera/contracts';

/*
 * How the trophy case lays out what the server says (ADR 0108 § 3, 4, 6, 7): the next trophy on top, then three
 * shelves in a fixed order, the earned objects first. Nothing here works out a fact: every count comes from the
 * server, this only sorts and rounds it.
 */

/** The shelves, always in this order (ADR 0108 § 4). */
/** The families the case lays on shelves; any other (the level, ADR 0104 § 16) is the role's to show elsewhere. */
export type ShelfFamily = Extract<TrophyCaseFamily, 'medal' | 'streak' | 'trophy'>;
export const SHELF_ORDER: readonly ShelfFamily[] = ['medal', 'streak', 'trophy'];
export const onShelf = (item: Pick<TrophyCaseItem, 'family'>): boolean =>
  SHELF_ORDER.some((family) => family === item.family);

/**
 * How far along, in whole percent, rounded down: 9 shifts out of 10 is 90 %, and an object never shows 100 % before
 * it is earned (ADR 0108 § 7). `null` when the object has no count.
 */
export function percentOf(progress: TrophyCaseProgress | null, earned: boolean): number | null {
  if (earned) return 100;
  // An object of one gesture has no way along to draw: 0 of 1 only weighs it as the next trophy (recette 16/11, CRE-14).
  if (progress === null || progress.unit === 'once') return null;
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
  readonly family: ShelfFamily;
  readonly items: readonly TrophyCaseItem[];
  readonly earned: number;
}

/**
 * The three shelves, an empty one left out unless the role keeps it to say why it is empty (recette 16/11, CHT-17).
 * The sort is stable: the server's order breaks a tie.
 */
export function shelvesOf(trophyCase: TrophyCase, keepEmpty: readonly ShelfFamily[] = []): Shelf[] {
  return SHELF_ORDER.map((family) => {
    const items = trophyCase.items.filter((item) => item.family === family).toSorted(byShelfOrder);
    return { family, items, earned: items.filter(isEarned).length };
  }).filter((shelf) => shelf.items.length > 0 || keepEmpty.includes(shelf.family));
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

/** A phone lays a shelf three objects to a row. */
export const PHONE_ROW = 3;

/**
 * On a phone, a shelf shows what was earned and the next object, in full rows of three, so no row stands half empty
 * (recette 16/11, CRE-14). « Voir tout » only hides two rows or more: a single row left over is shown at once.
 */
export function foldedShelf(shelf: Shelf): { shown: readonly TrophyCaseItem[]; hidden: number } {
  const earned = shelf.items.filter(isEarned);
  const waiting = shelf.items.filter((item) => !isEarned(item));
  const wanted = earned.length + Math.min(waiting.length, 1);
  const rows = Math.max(1, Math.ceil(wanted / PHONE_ROW));
  const count = shelf.items.length - rows * PHONE_ROW > PHONE_ROW ? rows * PHONE_ROW : shelf.items.length;
  const shown = [...earned, ...waiting].slice(0, count);
  return { shown, hidden: shelf.items.length - shown.length };
}

export const earnedCount = (trophyCase: TrophyCase): number => trophyCase.items.filter(isEarned).length;
