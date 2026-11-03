import type { ConnectorConfig } from '@impera/contracts';

/**
 * When the next poll of an account may run: its interval after the last one, plus a random jitter so the rhythm
 * never looks mechanical (connectors.md § Règles de bonne conduite). `random` is in [0, 1).
 */
export function nextPollAt(
  lastPollAt: Date | null,
  config: ConnectorConfig,
  now: Date,
  random: number,
): Date {
  const jitterMs = Math.floor(random * (config.jitterSeconds + 1)) * 1_000;
  if (lastPollAt === null) return new Date(now.getTime() + jitterMs);
  const due = lastPollAt.getTime() + config.pollIntervalSeconds * 1_000 + jitterMs;
  return new Date(Math.max(due, now.getTime()));
}

/** Overlap re-read on every poll: ingestion is idempotent, a message dated on the boundary is never missed. */
export const POLL_OVERLAP_SECONDS = 60;

export interface BreakerState {
  readonly consecutiveErrors: number;
  readonly pausedUntil: Date | null;
}

/** After a failed poll: count it, and open the breaker for a while once the threshold is reached. */
export function afterFailure(
  state: BreakerState,
  config: ConnectorConfig,
  now: Date,
): BreakerState & { readonly opened: boolean } {
  const consecutiveErrors = state.consecutiveErrors + 1;
  if (consecutiveErrors < config.breakerThreshold)
    return { consecutiveErrors, pausedUntil: null, opened: false };
  return {
    consecutiveErrors: 0,
    pausedUntil: new Date(now.getTime() + config.breakerPauseMinutes * 60_000),
    opened: true,
  };
}

export function isPaused(state: BreakerState, now: Date): boolean {
  return state.pausedUntil !== null && state.pausedUntil > now;
}
