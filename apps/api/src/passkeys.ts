import { randomUUID } from 'node:crypto';

import { getAuthenticatorName } from '@better-auth/passkey';
import {
  AuditEntryIdSchema,
  deviceOf,
  networkOf,
  newId,
  PasskeyGestureBodySchema,
  type Passkey,
  type PasskeyCredential,
} from '@nirvana/contracts';
import { and, eq, schema, sql, withAdmin, type Database } from '@nirvana/db';
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { z } from 'zod';

import { publishSecurityAlert, roleOf } from './security-alerts';

/**
 * Passkeys (ADR 0053), what the Better Auth plugin leaves to us: which account a key belongs to, its last use, the
 * alerts, and the confirmation of a sensitive action by a gesture (§ 4), which the plugin does not offer: its own
 * gesture opens a new session, ours stamps the one the request came with.
 */

/** The challenge of a confirmation lives this long, one per session (a new one replaces it). */
const CONFIRMATION_SECONDS = 5 * 60;
const CONFIRMATION_PREFIX = 'passkey-confirm:';

/** The credential id of a gesture's body, or null for a body that is not one (read before validation). */
export function credentialIdOf(body: unknown): string | null {
  const parsed = PasskeyGestureBodySchema.safeParse(body);
  return parsed.success ? parsed.data.response.id : null;
}

/** The account a key belongs to, null for an unknown key. */
export async function passkeyOwnerOf(db: Database, credentialId: string | null): Promise<string | null> {
  if (credentialId === null) return null;
  const [row] = await db
    .select({ userId: schema.passkey.userId })
    .from(schema.passkey)
    .where(eq(schema.passkey.credentialID, credentialId))
    .limit(1);
  return row?.userId ?? null;
}

/** The plugin's sign-in options, with user verification required of the browser (the plugin asks it as preferred). */
export function requireUserVerification(json: unknown): unknown {
  return typeof json === 'object' && json !== null ? { ...json, userVerification: 'required' } : json;
}

/**
 * Writes a key's last use; returns its account when the key had never been used before (a sign-in by a key just added
 * on another device, or a synced one), null otherwise.
 */
export async function markPasskeyUsed(db: Database, credentialId: string): Promise<string | null> {
  const used = await db.execute<{ user_id: string; first: boolean }>(sql`
    update passkey p set last_used_at = now()
    from (select id, last_used_at is null as first from passkey where credential_id = ${credentialId} for update) before
    where p.id = before.id
    returning p.user_id, before.first`);
  const row = used.rows[0];
  return row?.first === true ? row.user_id : null;
}

/** A key as Réglages › Sécurité shows it: never its public key nor its credential id. */
function passkeyView(row: {
  readonly id: string;
  readonly name: string | null;
  readonly aaguid: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}): Passkey {
  return {
    id: row.id,
    device: row.name ?? 'Appareil inconnu',
    keychain: getAuthenticatorName(row.aaguid ?? undefined) ?? null,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt === null ? null : row.lastUsedAt.toISOString(),
  };
}

const passkeyColumns = {
  id: schema.passkey.id,
  name: schema.passkey.name,
  aaguid: schema.passkey.aaguid,
  createdAt: schema.passkey.createdAt,
  lastUsedAt: schema.passkey.lastUsedAt,
};

/** One key of an account, as shown; null if it is not that account's. */
export async function passkeyOf(db: Database, userId: string, passkeyId: string): Promise<Passkey | null> {
  const [row] = await db
    .select(passkeyColumns)
    .from(schema.passkey)
    .where(and(eq(schema.passkey.id, passkeyId), eq(schema.passkey.userId, userId)));
  return row === undefined ? null : passkeyView(row);
}

/** Every key of an account, the most recently used first. */
export async function passkeysOf(db: Database, userId: string): Promise<Passkey[]> {
  const rows = await db
    .select(passkeyColumns)
    .from(schema.passkey)
    .where(eq(schema.passkey.userId, userId))
    .orderBy(sql`coalesce(${schema.passkey.lastUsedAt}, ${schema.passkey.createdAt}) desc`);
  return rows.map(passkeyView);
}

/** The device a key is added from, as the sessions are named: « Safari sur iPhone ». */
export const deviceName = (userAgent: string | undefined): string => deviceOf(userAgent);

/**
 * A key added (ADR 0053 § 7): its line of `audit_log`, and an alert to the urgent groups whatever the account, a new
 * lasting way in like a second factor set up anew.
 */
export function recordPasskeyAdded(
  adminDb: Database,
  added: { readonly userId: string; readonly passkeyId: string; readonly ip: string },
): Promise<void> {
  return withAdmin(adminDb, async (tx) => {
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId: added.userId,
      action: 'auth.passkey_added',
      entity: 'user',
      entityId: added.userId,
      details: { passkeyId: added.passkeyId },
      ip: added.ip,
    });
    await publishSecurityAlert(tx, null, {
      reason: 'passkey_added',
      userId: added.userId,
      role: await roleOf(tx, added.userId),
      network: networkOf(added.ip),
    });
  });
}

/** Takes back a key whose audit line and alert could not be written: no alert must always mean no key (ADR 0053 § 7). */
export async function takeBackPasskey(db: Database, passkeyId: string): Promise<void> {
  await db.delete(schema.passkey).where(eq(schema.passkey.id, passkeyId));
}

/** The owner signed in with a key never used before (ADR 0053 § 7); another account's first use is not told. */
export function alertOwnerPasskeySignIn(adminDb: Database, userId: string, ip: string): Promise<void> {
  return withAdmin(adminDb, async (tx) => {
    if ((await roleOf(tx, userId)) !== 'owner') return;
    await publishSecurityAlert(tx, null, {
      reason: 'passkey_new_sign_in',
      userId,
      role: 'owner',
      network: networkOf(ip),
    });
  });
}

const ChallengeSchema = z.object({
  challenge: z.string().min(1),
  userId: z.string().min(1),
  /** The key the confirmation may not use: the one being removed (ADR 0053 § 5). */
  excluding: z.string().min(1).nullable().default(null),
});

/** The stored challenge, `null` when missing or unreadable (both mean: ask for a new one). */
function challengeOf(value: string | undefined): z.infer<typeof ChallengeSchema> | null {
  if (value === undefined) return null;
  try {
    const parsed = ChallengeSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** An assertion (a gesture on an existing key), as simplewebauthn reads it; null for a registration or anything else. */
const AssertionSchema = z.object({
  clientDataJSON: z.string().min(1),
  authenticatorData: z.string().min(1),
  signature: z.string().min(1),
  userHandle: z.string().optional(),
});

function assertionOf(credential: PasskeyCredential): AuthenticationResponseJSON | null {
  const response = AssertionSchema.safeParse(credential.response);
  if (!response.success) return null;
  const { userHandle, ...signed } = response.data;
  return {
    id: credential.id,
    rawId: credential.rawId,
    type: credential.type,
    response: userHandle === undefined || userHandle === '' ? signed : { ...signed, userHandle },
    clientExtensionResults: {},
    ...(credential.authenticatorAttachment === undefined
      ? {}
      : { authenticatorAttachment: credential.authenticatorAttachment }),
  };
}

interface Relying {
  readonly rpID: string;
  readonly origin: string;
}

const transportsOf = (value: string | null): AuthenticatorTransportFuture[] | undefined =>
  value === null || value === ''
    ? undefined
    : value.split(',').filter((transport): transport is AuthenticatorTransportFuture => transport !== '');

/**
 * The options of a confirmation (ADR 0053 § 4): a fresh challenge for this session alone, the account's keys only,
 * user verification required. Null when the account has no key.
 */
export async function confirmationOptions(
  db: Database,
  relying: Relying,
  target: { readonly userId: string; readonly sessionId: string; readonly excluding: string | null },
): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const keys = await db
    .select({ credentialID: schema.passkey.credentialID, transports: schema.passkey.transports })
    .from(schema.passkey)
    .where(
      and(
        eq(schema.passkey.userId, target.userId),
        target.excluding === null ? undefined : sql`${schema.passkey.id} <> ${target.excluding}`,
      ),
    );
  if (keys.length === 0) return null;
  const options = await generateAuthenticationOptions({
    rpID: relying.rpID,
    userVerification: 'required',
    allowCredentials: keys.map((key) => {
      const transports = transportsOf(key.transports);
      return transports === undefined ? { id: key.credentialID } : { id: key.credentialID, transports };
    }),
  });
  const identifier = `${CONFIRMATION_PREFIX}${target.sessionId}`;
  await db.transaction(async (tx) => {
    await tx.delete(schema.verification).where(eq(schema.verification.identifier, identifier));
    await tx.insert(schema.verification).values({
      id: randomUUID(),
      identifier,
      value: JSON.stringify({
        challenge: options.challenge,
        userId: target.userId,
        excluding: target.excluding,
      }),
      expiresAt: sql`now() + make_interval(secs => ${CONFIRMATION_SECONDS})`,
    });
  });
  return options;
}

export type ConfirmationOutcome =
  { readonly outcome: 'confirmed'; readonly passkeyId: string } | { readonly outcome: 'expired' | 'refused' };

/**
 * Checks a confirmation gesture against the challenge of this session, used up whatever the outcome: a key of the
 * account, its signature, its counter, the origin, user verification. `expired` when no live challenge exists (the page
 * asks for a new one, nothing counted); `refused` for a gesture the server checked and rejected.
 */
export async function confirmGesture(
  db: Database,
  relying: Relying,
  gesture: { readonly userId: string; readonly sessionId: string; readonly response: PasskeyCredential },
): Promise<ConfirmationOutcome> {
  const identifier = `${CONFIRMATION_PREFIX}${gesture.sessionId}`;
  const [stored] = await db
    .delete(schema.verification)
    .where(and(eq(schema.verification.identifier, identifier), sql`${schema.verification.expiresAt} > now()`))
    .returning({ value: schema.verification.value });
  const challenge = challengeOf(stored?.value);
  if (challenge?.userId !== gesture.userId) return { outcome: 'expired' };
  const [key] = await db
    .select()
    .from(schema.passkey)
    .where(
      and(eq(schema.passkey.credentialID, gesture.response.id), eq(schema.passkey.userId, gesture.userId)),
    );
  const assertion = assertionOf(gesture.response);
  if (key === undefined || assertion === null || key.id === challenge.excluding)
    return { outcome: 'refused' };
  try {
    const transports = transportsOf(key.transports);
    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge.challenge,
      expectedOrigin: relying.origin,
      expectedRPID: relying.rpID,
      credential: {
        id: key.credentialID,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, 'base64')),
        counter: key.counter,
        ...(transports === undefined ? {} : { transports }),
      },
      requireUserVerification: true,
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified)
      return { outcome: 'refused' };
    await db
      .update(schema.passkey)
      .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: sql`now()` })
      .where(eq(schema.passkey.id, key.id));
    return { outcome: 'confirmed', passkeyId: key.id };
  } catch {
    // simplewebauthn throws for every check that fails (signature, counter, origin, challenge, user verification).
    return { outcome: 'refused' };
  }
}
