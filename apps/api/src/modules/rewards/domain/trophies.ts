/*
 * The trophies (ADR 0104 § 15): a closed list written here, each tied to a fact one can check. A trophy earned is
 * never lost, even when a sale is refunded afterwards: this only says which ones the facts of today give.
 */

export const TROPHY_KINDS = [
  'first_sale',
  'day_record',
  'fortnight_record',
  'fortnight_on_time',
  'streak_5',
  'streak_10',
  'streak_25',
  'ten_ppv_shift',
] as const;
export type TrophyKind = (typeof TROPHY_KINDS)[number];

/** How many shifts in a row each streak trophy asks. */
export const STREAK_TROPHIES: Readonly<Record<'streak_5' | 'streak_10' | 'streak_25', number>> = {
  streak_5: 5,
  streak_10: 10,
  streak_25: 25,
};

/** How many paid media bought in one shift the trophy asks. */
const PPV_SHIFT_TARGET = 10;

export interface TrophyFacts {
  /** Sales read on the member's statements, ever. */
  readonly sales: number;
  /** A day closed above the member's best day before it. A first day beats nothing. */
  readonly dayRecordBeaten: boolean;
  /** A fortnight closed above the member's best fortnight before it. */
  readonly fortnightRecordBeaten: boolean;
  /** A closed fortnight with at least one shift and no report late or missing. */
  readonly fortnightOnTime: boolean;
  readonly bestStreak: number;
  /** The most paid media bought in one of their shifts; `null` while ADR 0092 § 1 does not count them yet. */
  readonly ppvBoughtInShift: number | null;
}

export function trophiesOf(facts: TrophyFacts): TrophyKind[] {
  const earned: Record<TrophyKind, boolean> = {
    first_sale: facts.sales > 0,
    day_record: facts.dayRecordBeaten,
    fortnight_record: facts.fortnightRecordBeaten,
    fortnight_on_time: facts.fortnightOnTime,
    streak_5: facts.bestStreak >= STREAK_TROPHIES.streak_5,
    streak_10: facts.bestStreak >= STREAK_TROPHIES.streak_10,
    streak_25: facts.bestStreak >= STREAK_TROPHIES.streak_25,
    ten_ppv_shift: facts.ppvBoughtInShift !== null && facts.ppvBoughtInShift >= PPV_SHIFT_TARGET,
  };
  return TROPHY_KINDS.filter((kind) => earned[kind]);
}

/** Whether a figure beats the best of those before it: nothing to beat, no record. */
export const beatsRecord = (valueMinor: number, earlierMinor: readonly number[]): boolean =>
  earlierMinor.length > 0 && valueMinor > Math.max(...earlierMinor);
