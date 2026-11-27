import type { FaultLevel, FaultTone } from '@impera/contracts';

/**
 * The chatter's review, pure (ADR 0170 §§ 15 and 26 to 32). A fault's level comes from its code, saved out of the
 * repository; the model never chooses it. The count, the tone and the case are decided here, never in a prompt.
 */

/** How long the repetition window lasts (ADR 0170 § 15). */
const REPEAT_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

/** Where a contested occurrence stands (§ 14): it counts only once the manager has upheld it. */
export type ContestState = 'none' | 'pending' | 'upheld' | 'dropped';

/** One occurrence of a fault by a chatter, as the store reads it. */
export interface FaultOccurrence {
  readonly at: Date;
  readonly contest: ContestState;
}

/**
 * Whether an occurrence counts toward a case (§ 29): never a piece of advice, never while contested or once
 * dropped, and only after the fault was first explained to him in a review.
 */
export function occurrenceCounts(
  level: FaultLevel,
  occurrence: FaultOccurrence,
  explainedAt: Date | null,
): boolean {
  if (level === 'advice') return false;
  if (occurrence.contest === 'pending' || occurrence.contest === 'dropped') return false;
  return explainedAt !== null && occurrence.at.getTime() > explainedAt.getTime();
}

/**
 * The tone of a card (§ 30): a piece of advice stays grey; a standard fault is explained the first time, then
 * recalled firmly; a firm fault or an owner alert is grave from the first time.
 */
export function faultTone(level: FaultLevel, explainedAt: Date | null): FaultTone {
  switch (level) {
    case 'advice':
      return 'advice';
    case 'standard':
      return explainedAt === null ? 'explain' : 'firm';
    case 'firm':
    case 'owner_alert':
      return 'grave';
  }
}

/** How many counted occurrences open a case, past the explanation (§ 28); null: never. */
function countToOpen(level: FaultLevel): number | null {
  switch (level) {
    case 'advice':
      return null;
    case 'standard':
      return 3;
    case 'firm':
      return 1;
    case 'owner_alert':
      return 0;
  }
}

/**
 * Whether the occurrence at `now` opens a case for the owner (§§ 15, 28, 29). An owner alert always does. During his
 * two weeks of mentoring, nothing else does. Otherwise, the counted occurrences of the same fault in the last two
 * weeks, this one included, reach the level's threshold.
 */
export function caseOpens(input: {
  readonly level: FaultLevel;
  readonly now: Date;
  readonly inMentoring: boolean;
  readonly explainedAt: Date | null;
  /** Every occurrence of the same fault by the same chatter, this one included. */
  readonly occurrences: readonly FaultOccurrence[];
}): boolean {
  const threshold = countToOpen(input.level);
  if (threshold === null) return false;
  if (threshold === 0) return true;
  if (input.inMentoring) return false;
  const since = input.now.getTime() - REPEAT_WINDOW_DAYS * DAY_MS;
  const counted = input.occurrences.filter(
    (o) =>
      o.at.getTime() > since &&
      o.at.getTime() <= input.now.getTime() &&
      occurrenceCounts(input.level, o, input.explainedAt),
  ).length;
  return counted >= threshold;
}

/** A missed sale, in minor units, as the code priced it (§ 27); null when it cannot be priced. */
export interface MissedAmount {
  readonly minor: number;
  readonly currency: string;
}

/**
 * The review's missed total per currency (§ 27): only what the code priced, contested occurrences left out until
 * upheld. A total never mixes currencies.
 */
export function missedTotals(
  cards: readonly { readonly missed: MissedAmount | null; readonly contest: ContestState }[],
): ReadonlyMap<string, number> {
  const totals = new Map<string, number>();
  for (const card of cards) {
    if (card.missed === null || card.contest === 'pending' || card.contest === 'dropped') continue;
    totals.set(card.missed.currency, (totals.get(card.missed.currency) ?? 0) + card.missed.minor);
  }
  return totals;
}
