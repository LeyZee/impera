import { UserRoleSchema, type UserRole } from '@impera/contracts';

/**
 * How long a dashboard session lives (security.md § 6, SEC-17, ADR 0160). Two limits by role, whichever comes first: a
 * time without activity, and a time from its creation whatever its use (ADR 0046 § 6). Neither counts as a recent
 * sign-in: a sensitive action still asks for the password and the code (`requireRecentLogin`).
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface SessionLifetime {
  /** Without activity for longer than this, the session ends. */
  readonly idleMs: number;
  /** However much it is used, a session opened longer ago than this is refused at its next request. */
  readonly maxAgeMs: number;
}

/**
 * Every role but those below (an operator: manager or chatter), and any role that does not validate: 12 hours without
 * activity, 7 days at most. They read the fans' conversations, at times on a shared device.
 */
export const SHORT_LIFETIME: SessionLifetime = { idleMs: 12 * HOUR_MS, maxAgeMs: 7 * DAY_MS };

/**
 * The roles with a longer lifetime (Charles, 20/11/2026): the owner 48 hours without activity and 7 days at most, his
 * account reading everything; the creator 7 days without activity and 30 days at most, as she reads only her own data
 * on her own phone.
 */
export const LONG_LIFETIMES: Readonly<Partial<Record<UserRole, SessionLifetime>>> = {
  owner: { idleMs: 48 * HOUR_MS, maxAgeMs: 7 * DAY_MS },
  creator: { idleMs: 7 * DAY_MS, maxAgeMs: 30 * DAY_MS },
};

/** The lifetime of a session of this role; a role that does not validate gets the short one. */
export function lifetimeOf(role: unknown): SessionLifetime {
  const parsed = UserRoleSchema.safeParse(role);
  return (parsed.success ? LONG_LIFETIMES[parsed.data] : undefined) ?? SHORT_LIFETIME;
}

/**
 * The longest time without activity any role gets: Better Auth's own lifetime of a session (`expiresIn`) and the
 * `Max-Age` of its cookie. The shorter ones are ours to apply.
 */
export const LONGEST_IDLE_MS = Math.max(
  SHORT_LIFETIME.idleMs,
  ...Object.values(LONG_LIFETIMES).map((lifetime) => lifetime.idleMs),
);

export interface SessionTimes {
  /** The account's role as stored, unvalidated. */
  readonly role: unknown;
  readonly createdAt: Date;
  /** Its last refresh (`session.updated_at`), which Better Auth writes at most once per `updateAge` of use. */
  readonly lastActiveAt: Date;
}

/** Why a session is over at `now`: past its role's age limit, or idle past its limit; `null` while it is alive. */
export function sessionEnd(session: SessionTimes, now: Date): 'max_age' | 'idle' | null {
  const { idleMs, maxAgeMs } = lifetimeOf(session.role);
  if (now.getTime() - session.createdAt.getTime() > maxAgeMs) return 'max_age';
  if (now.getTime() - session.lastActiveAt.getTime() > idleMs) return 'idle';
  return null;
}
