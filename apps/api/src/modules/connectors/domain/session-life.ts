/**
 * How long a captured platform session still lives, read from its own expiry (reveal-connector-spec.md § 2): Reveal's
 * token lives 24 h from the login to Reveal, never from the « Sync », and Reveal never renews it. A « Sync » only copies
 * the token the browser already holds, so a browser logged in yesterday hands over a token with an hour left.
 */

/** `health` and the « Sync » say `warning` this close to the expiry. */
export const SESSION_WARNING_BEFORE_MS = 2 * 3_600_000;

/**
 * Under this much life left at the « Sync », the token is not a fresh login's: the owner is told to log out of the
 * platform and in again before syncing (16/11, a « Sync » that held one hour).
 */
const SESSION_FRESH_MIN_MS = 20 * 3_600_000;

/** What a stored session's expiry says at the « Sync ». */
export interface SessionLife {
  /** `warning` when it expires within `SESSION_WARNING_BEFORE_MS`, as `health` would say at the next read. */
  readonly state: 'valid' | 'warning';
  /** The token's own expiry; `null` when it does not carry one we can read. */
  readonly expiresAt: Date | null;
  /** Less than `SESSION_FRESH_MIN_MS` left: log out and in again, then sync. Never said of an unreadable expiry. */
  readonly reconnectFirst: boolean;
}

export function sessionLife(expiresAt: Date | null, now: Date): SessionLife {
  if (expiresAt === null) return { state: 'valid', expiresAt: null, reconnectFirst: false };
  const left = expiresAt.getTime() - now.getTime();
  return {
    state: left < SESSION_WARNING_BEFORE_MS ? 'warning' : 'valid',
    expiresAt,
    reconnectFirst: left < SESSION_FRESH_MIN_MS,
  };
}
