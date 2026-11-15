import type { Transaction } from '@impera/db';

import { anyPerfectDay, bestStreakOf, streakOf } from '../../domain/streak';

import { herDayRecords, zoneOf } from './agenda-store';

/** What the creator's game reads of her agenda (ADR 0107 § 1 and § 3): her day streak, its best, a perfect day. */
export interface CreatorDaysForGame {
  /** Her today, in her zone. */
  readonly today: string;
  readonly current: number;
  readonly best: number;
  readonly perfectDay: boolean;
}

/**
 * Her days as the game counts them, in the game's own job or read: the module owns her agenda, the game gets this
 * function through the module's `index.ts`, never the tables. On the admin connection, bounded to her creator; nothing
 * is written.
 */
export async function creatorDaysForGameUnscoped(
  tx: Transaction,
  creatorId: string,
  now: Date,
): Promise<CreatorDaysForGame> {
  const zone = await zoneOf(tx, creatorId);
  const { today, records } = await herDayRecords(tx, zone, now, creatorId);
  return {
    today,
    current: streakOf(records, today).days,
    best: bestStreakOf(records, today),
    perfectDay: anyPerfectDay(records),
  };
}
