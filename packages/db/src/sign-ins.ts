import { and, eq, like } from 'drizzle-orm';

import type { Transaction } from './client';
import { session, twoFactor, user, verification } from './schema/auth';

/**
 * Better Auth's `two-factor` plugin keeps each trusted device (ADR 0046 § 3) as a `verification` row whose identifier
 * starts with this and whose value is the account's id; its cookie is honoured only while that row exists.
 */
const TRUSTED_DEVICE_PREFIX = 'trust-device-';

/**
 * Ends every way an account is signed in (`null`: every account): its sessions and its trusted devices, which would
 * otherwise skip the code at the next sign-in for 30 days. Run by every step that must sign an account out everywhere
 * (a reset link, a reset of the second factor, a departure, `ops:revoke-sessions`), in the caller's transaction.
 */
export async function revokeSignIns(
  tx: Transaction,
  userId: string | null,
): Promise<{ readonly sessions: number; readonly trustedDevices: number }> {
  const sessions = await tx
    .delete(session)
    .where(userId === null ? undefined : eq(session.userId, userId))
    .returning({ id: session.id });
  const isTrustedDevice = like(verification.identifier, `${TRUSTED_DEVICE_PREFIX}%`);
  const devices = await tx
    .delete(verification)
    .where(userId === null ? isTrustedDevice : and(eq(verification.value, userId), isTrustedDevice))
    .returning({ id: verification.id });
  return { sessions: sessions.length, trustedDevices: devices.length };
}

/**
 * Puts an account's second factor back to zero (ADR 0046 § 2): its secret and backup codes are erased and it signs in
 * again with its password alone, straight onto the activation of a new code. Signs it out everywhere first. Run by a
 * reset link (EQ-10) and by `ops:reset-second-factor`, in the caller's transaction.
 */
export async function resetSecondFactor(
  tx: Transaction,
  userId: string,
): Promise<{
  readonly sessions: number;
  readonly trustedDevices: number;
  readonly hadSecondFactor: boolean;
}> {
  const revoked = await revokeSignIns(tx, userId);
  const erased = await tx
    .delete(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .returning({ id: twoFactor.id });
  await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
  return { ...revoked, hadSecondFactor: erased.length > 0 };
}
