import { and, eq, like, ne } from 'drizzle-orm';

import type { Transaction } from './client';
import { passkey, session, twoFactor, user, verification } from './schema/auth';

/**
 * Better Auth's `two-factor` plugin keeps each trusted device (ADR 0046 § 3) as a `verification` row whose identifier
 * starts with this and whose value is the account's id; its cookie is honoured only while that row exists.
 */
const TRUSTED_DEVICE_PREFIX = 'trust-device-';

/**
 * Ends every way an account is signed in (`null`: every account): its sessions and its trusted devices, which would
 * otherwise skip the code at the next sign-in for 30 days. Run by every step that must sign an account out everywhere
 * (a reset link, a reset of the second factor, a departure, `ops:revoke-sessions`), in the caller's transaction.
 * `keepSessionId` spares one session, the one closing all the others (Réglages › Sécurité, SEC-04), and
 * `keepTrustedDevice` the trusted device of the browser it came from (`verification` identifier, recette 05/11 reco 24):
 * the other devices go.
 */
export async function revokeSignIns(
  tx: Transaction,
  userId: string | null,
  options: { readonly keepSessionId?: string; readonly keepTrustedDevice?: string } = {},
): Promise<{ readonly sessions: number; readonly trustedDevices: number }> {
  const ofAccount = userId === null ? undefined : eq(session.userId, userId);
  const sessions = await tx
    .delete(session)
    .where(
      options.keepSessionId === undefined ? ofAccount : and(ofAccount, ne(session.id, options.keepSessionId)),
    )
    .returning({ id: session.id });
  const isTrustedDevice = like(verification.identifier, `${TRUSTED_DEVICE_PREFIX}%`);
  const devices = await tx
    .delete(verification)
    .where(
      and(
        userId === null ? isTrustedDevice : and(eq(verification.value, userId), isTrustedDevice),
        options.keepTrustedDevice === undefined
          ? undefined
          : ne(verification.identifier, options.keepTrustedDevice),
      ),
    )
    .returning({ id: verification.id });
  return { sessions: sessions.length, trustedDevices: devices.length };
}

/**
 * Removes every passkey of an account (ADR 0053 § 5): a reset of its second factor, a reset link (EQ-10), a departure
 * (EQ-14), the owner's « Retirer ses clés ». Never closing sessions: that is another gesture, a stolen session is
 * closed without losing Face ID on one's own phone. In the caller's transaction; returns how many went.
 */
export async function removePasskeys(tx: Transaction, userId: string): Promise<number> {
  const removed = await tx.delete(passkey).where(eq(passkey.userId, userId)).returning({ id: passkey.id });
  return removed.length;
}

/**
 * Puts an account's second factor back to zero (ADR 0046 § 2): its secret and backup codes are erased and it signs in
 * again with its password alone, straight onto the activation of a new code. Signs it out everywhere first, and its
 * passkeys go too (ADR 0053 § 5): a key is never older than the code it was added under. Run by a reset link (EQ-10)
 * and by `ops:reset-second-factor`, in the caller's transaction.
 */
export async function resetSecondFactor(
  tx: Transaction,
  userId: string,
): Promise<{
  readonly sessions: number;
  readonly trustedDevices: number;
  readonly hadSecondFactor: boolean;
  readonly passkeys: number;
}> {
  const revoked = await revokeSignIns(tx, userId);
  const passkeys = await removePasskeys(tx, userId);
  const erased = await tx
    .delete(twoFactor)
    .where(eq(twoFactor.userId, userId))
    .returning({ id: twoFactor.id });
  await tx.update(user).set({ twoFactorEnabled: false }).where(eq(user.id, userId));
  return { ...revoked, hadSecondFactor: erased.length > 0, passkeys };
}
