import { DEFAULT_TREND_SIGNAL_LIFETIME_DAYS, type TrendMetrics } from '@impera/contracts';

const DAY_MS = 24 * 60 * 60_000;

/** When a signal seen at `observedAt` stops being read (ADR 0060 § 2): its lifetime in whole days, 14 by default. */
export function signalExpiresAt(
  observedAt: Date,
  lifetimeDays: number = DEFAULT_TREND_SIGNAL_LIFETIME_DAYS,
): Date {
  if (!Number.isInteger(lifetimeDays) || lifetimeDays < 1)
    throw new RangeError('a signal lives one day at least');
  return new Date(observedAt.getTime() + lifetimeDays * DAY_MS);
}

/** A signal is read until its expiry, excluded: at that instant it is already gone. */
export function isLive(signal: { readonly expiresAt: Date }, now: Date): boolean {
  return now.getTime() < signal.expiresAt.getTime();
}

/**
 * « Dépasse nettement la moyenne de son compte » (ADR 0060 § 2, sources 3 and 6), fixed in code: a post's figure is at
 * least `STANDS_OUT_FACTOR` times the mean of the other posts read of the same account, and at least
 * `STANDS_OUT_MIN_POSTS` of them were read. Views when the page gave them for the post and enough others, else likes.
 */
export const STANDS_OUT_FACTOR = 3;
export const STANDS_OUT_MIN_POSTS = 5;

type Figure = 'views' | 'likes';

function meanOf(posts: readonly TrendMetrics[], figure: Figure): number | null {
  const values = posts.map((post) => post[figure]).filter((value): value is number => value !== null);
  if (values.length < STANDS_OUT_MIN_POSTS) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Whether `post` stands out from `others` (the other posts read of its account, itself excluded). */
export function standsOut(post: TrendMetrics, others: readonly TrendMetrics[]): boolean {
  for (const figure of ['views', 'likes'] as const) {
    const value = post[figure];
    const mean = meanOf(others, figure);
    if (value === null || mean === null) continue;
    // A mean of zero: any figure of one or more stands out, nothing at zero does.
    return mean === 0 ? value > 0 : value >= STANDS_OUT_FACTOR * mean;
  }
  return false;
}
