import { z } from 'zod';

import { REAUTHENTICATION_ERROR_CODE } from './auth';

/**
 * Clés d'accès (ADR 0053): Face ID, a fingerprint or the phone's code unlocks a key that never leaves the device; the
 * server keeps its public part. One gesture is worth the password and the code, at sign-in and before a sensitive
 * action. A key is added only on a session whose password and code were confirmed within `PASSKEY_ADD_WINDOW_MINUTES`.
 */

/** A key is added only this soon after the password and the code were confirmed on the session (ADR 0053 § 2). */
export const PASSKEY_ADD_WINDOW_MINUTES = 5;

const Base64UrlSchema = z
  .string()
  .min(1)
  .max(16_384)
  .regex(/^[A-Za-z0-9_-]+$/u);

/**
 * What the browser hands back after a gesture (WebAuthn's `PublicKeyCredential.toJSON()`, as `@simplewebauthn/browser`
 * gives it), bounded and checked for shape only: the signature, the challenge and the origin are checked by the
 * server against what it issued, never trusted from here.
 */
export const PasskeyCredentialSchema = z.object({
  id: Base64UrlSchema.max(1_024),
  rawId: Base64UrlSchema.max(1_024),
  type: z.literal('public-key'),
  // clientDataJSON, attestationObject or authenticatorData and signature, userHandle, transports, publicKeyAlgorithm.
  response: z.record(
    z.string().max(64),
    z.union([
      z
        .string()
        .max(16_384)
        .regex(/^[A-Za-z0-9_-]*$/u),
      z.array(z.string().max(32)).max(8),
      z.number().int(),
    ]),
  ),
  clientExtensionResults: z.record(z.string().max(64), z.unknown()).optional(),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
});
export type PasskeyCredential = z.infer<typeof PasskeyCredentialSchema>;

/** The body of every route that checks a gesture: sign-in, adding a key, confirming a sensitive action. */
export const PasskeyGestureBodySchema = z.object({ response: PasskeyCredentialSchema });
export type PasskeyGestureBody = z.infer<typeof PasskeyGestureBodySchema>;

/**
 * One of the signed-in person's keys, as Réglages › Sécurité lists them: the device it was added from (read from the
 * browser), the keychain that holds it when the authenticator says (« iCloud Keychain », « Google Password Manager »),
 * when it was added and last used. Never the key itself, never its credential id.
 */
export const PasskeySchema = z.object({
  id: z.string().min(1),
  device: z.string().min(1),
  keychain: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type Passkey = z.infer<typeof PasskeySchema>;
export const PasskeysSchema = z.object({ passkeys: z.array(PasskeySchema) });
export type Passkeys = z.infer<typeof PasskeysSchema>;

/** How many keys were removed (the owner removing every key of an account). */
export const RemovedPasskeysSchema = z.object({ passkeys: z.number().int().min(0) });
export type RemovedPasskeys = z.infer<typeof RemovedPasskeysSchema>;

/** The error codes of the keys, besides `rate_limited`, `request_invalid` and the confirmation's. */
export const PASSKEY_ERROR_CODES = [
  /** A gesture the server refused: unknown key, wrong signature, no user verification, another site. */
  'passkey_unauthenticated',
  /** The challenge of the gesture expired or was used: the page asks for a new one. */
  'passkey_challenge_unauthenticated',
  /** No such key on this account, or no key at all to confirm with. */
  'passkey_not_found',
  /** A key that this account already holds. */
  'passkey_conflict',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type PasskeyErrorCode = (typeof PASSKEY_ERROR_CODES)[number];
