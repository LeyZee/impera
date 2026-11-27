import { createOTP } from '@better-auth/utils/otp';
import { newId, UserIdSchema, type FirstSteps, type SecondFactorSetup } from '@impera/contracts';
import { and, eq, schema, sql, type Database } from '@impera/db';
import { generateRandomString, symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { z } from 'zod';

import { backupCodeOptions } from './backup-codes';

const ISSUER = 'Impera';
const SECRET_LENGTH = 32;
const CodesSchema = z.array(z.string());

/** The `otpauth://` address of a secret, as Better Auth's `two-factor` plugin writes it (6 digits, 30 s). */
function addressOf(secret: string, email: string): string {
  return createOTP(secret, { digits: 6, period: 30 }).url(ISSUER, email);
}

/**
 * The activation waiting for its first code (ADR 0046 § 1): the secret and the ten backup codes of the account, made
 * once and given back as they are until a code confirms them. A reload, or a return from the authenticator app, shows
 * the same key: the one already added there keeps working. The row is the plugin's own (`verified = false`), written
 * as it writes it, so that its `verify-totp` confirms it. `null` when the account's code is already active.
 */
export async function pendingSetup(
  db: Database,
  authSecret: string,
  account: { readonly id: string; readonly email: string },
): Promise<SecondFactorSetup | null> {
  const codes = backupCodeOptions(authSecret);
  const read = async (): Promise<SecondFactorSetup | null | undefined> => {
    const [row] = await db
      .select({
        secret: schema.twoFactor.secret,
        backupCodes: schema.twoFactor.backupCodes,
        verified: schema.twoFactor.verified,
      })
      .from(schema.twoFactor)
      .where(eq(schema.twoFactor.userId, account.id));
    if (row === undefined) return undefined;
    if (row.verified) return null;
    return {
      totpURI: addressOf(await symmetricDecrypt({ key: authSecret, data: row.secret }), account.email),
      backupCodes: CodesSchema.parse(JSON.parse(await codes.storeBackupCodes.decrypt(row.backupCodes))),
    };
  };
  const waiting = await read();
  if (waiting !== undefined) return waiting;
  const secret = generateRandomString(SECRET_LENGTH);
  const backupCodes = codes.customBackupCodesGenerate();
  // Two starts at once make one row (`user_id` is unique): the second reads what the first wrote.
  const made = await db
    .insert(schema.twoFactor)
    .values({
      id: newId(UserIdSchema),
      userId: account.id,
      secret: await symmetricEncrypt({ key: authSecret, data: secret }),
      backupCodes: await codes.storeBackupCodes.encrypt(JSON.stringify(backupCodes)),
      verified: false,
    })
    .onConflictDoNothing({ target: schema.twoFactor.userId })
    .returning({ id: schema.twoFactor.id });
  if (made.length === 0) return (await read()) ?? null;
  return { totpURI: addressOf(secret, account.email), backupCodes };
}

/** The backup codes of an account as they stand, for the one screen that shows them again before they are said kept. */
export async function backupCodesOf(
  db: Database,
  authSecret: string,
  userId: string,
): Promise<string[] | null> {
  const [row] = await db
    .select({ backupCodes: schema.twoFactor.backupCodes })
    .from(schema.twoFactor)
    .where(and(eq(schema.twoFactor.userId, userId), eq(schema.twoFactor.verified, true)));
  if (row === undefined) return null;
  return CodesSchema.parse(
    JSON.parse(await backupCodeOptions(authSecret).storeBackupCodes.decrypt(row.backupCodes)),
  );
}

export async function firstStepsOf(db: Database, userId: string): Promise<FirstSteps> {
  const [row] = await db
    .select({ kept: schema.user.backupCodesKeptAt, welcomed: schema.user.welcomedAt })
    .from(schema.user)
    .where(eq(schema.user.id, userId));
  return { codesKept: row?.kept != null, welcomed: row?.welcomed != null };
}

/** Says a first step done, once: the first time stays. */
export async function markFirstStep(db: Database, userId: string, step: keyof FirstSteps): Promise<void> {
  const column = step === 'codesKept' ? schema.user.backupCodesKeptAt : schema.user.welcomedAt;
  await db
    .update(schema.user)
    .set(step === 'codesKept' ? { backupCodesKeptAt: new Date() } : { welcomedAt: new Date() })
    .where(and(eq(schema.user.id, userId), sql`${column} is null`));
}
