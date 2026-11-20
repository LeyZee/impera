import { UserRoleSchema, type UserRole } from '@impera/contracts';

/**
 * How long a dashboard session lives (security.md § 6, SEC-15). Two limits, whichever comes first: a time without
 * activity that depends on the role, and 7 days from its creation whatever its use (ADR 0046 § 6). Neither counts as a
 * recent sign-in: a sensitive action still asks for the password and the code (`requireRecentLogin`).
 */

/** However much it is used, a session opened more than 7 days ago is refused at its next request (ADR 0046 § 6). */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Without activity, the session of every role but those of `LONG_IDLE_ROLES` ends after 12 hours. */
export const SHORT_IDLE_MS = 12 * 60 * 60 * 1000;
/** Without activity, the session of a role of `LONG_IDLE_ROLES` ends after 48 hours (the owner's choice, 20/11/2026). */
export const LONG_IDLE_MS = 48 * 60 * 60 * 1000;
/**
 * The roles whose sessions get the long idle. The owner only: the creator's stays short until it is decided (SEC-15),
 * and adding her here is the whole change.
 */
export const LONG_IDLE_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['owner']);

/** The idle limit of a session of this role; a role that does not validate gets the short one. */
export function idleLimitMs(role: unknown): number {
  const parsed = UserRoleSchema.safeParse(role);
  return parsed.success && LONG_IDLE_ROLES.has(parsed.data) ? LONG_IDLE_MS : SHORT_IDLE_MS;
}

export interface SessionTimes {
  /** The account's role as stored, unvalidated. */
  readonly role: unknown;
  readonly createdAt: Date;
  /** Its last refresh (`session.updated_at`), which Better Auth writes at most once per `updateAge` of use. */
  readonly lastActiveAt: Date;
}

/** Why a session is over at `now`: past its 7 days, or idle past its role's limit; `null` while it is alive. */
export function sessionEnd(session: SessionTimes, now: Date): 'max_age' | 'idle' | null {
  if (now.getTime() - session.createdAt.getTime() > SESSION_MAX_AGE_MS) return 'max_age';
  if (now.getTime() - session.lastActiveAt.getTime() > idleLimitMs(session.role)) return 'idle';
  return null;
}
