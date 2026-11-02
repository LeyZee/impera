import { z } from 'zod';

/** Dashboard roles (security.md §6): `owner` administers, `operator` chats, `creator` sees her own (phase 5). */
export const UserRoleSchema = z.enum(['owner', 'operator', 'creator']);
export type UserRole = z.infer<typeof UserRoleSchema>;

/**
 * Who is signed in, as every route sees it. Never carries the session token. `creatorIds`: the creators whose every
 * conversation, fan and figure the account reads. `routedCreatorIds`: the creators where it reads only the
 * conversations routed to it (a team member whose scope is `self`, ADR 0024): their `creatorIds` are moved here.
 */
export const CurrentUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string(),
  role: UserRoleSchema,
  creatorIds: z.array(z.uuid()),
  routedCreatorIds: z.array(z.uuid()).default([]),
});
export type CurrentUser = z.infer<typeof CurrentUserSchema>;

/**
 * Error code of a sensitive action (ADR 0016, ADR 0046 § 3) when the password and the code were not given on this
 * session in the last 10 minutes: the page asks for both (`POST /v1/auth/reauthenticate`) and retries.
 */
export const REAUTHENTICATION_ERROR_CODE = 'reauthentication_forbidden';

/** The password as a sign-in reads it: bounded, its rules are checked where it is chosen (`PASSWORD_MIN_LENGTH`). */
const GivenPasswordSchema = z.string().min(1).max(512);

/**
 * A code of the second factor (ADR 0046): the 6 digits of the authenticator app, or a backup code (two groups of 5
 * letters and digits). Spaces a person types or pastes are dropped; letters keep their case.
 */
export const SecondFactorCodeSchema = z
  .string()
  .max(32)
  .transform((code) => code.replace(/\s+/gu, ''))
  .pipe(z.string().regex(/^(?:\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})$/u));
export type SecondFactorCode = z.infer<typeof SecondFactorCodeSchema>;

/** Whether a code is a backup code rather than the authenticator's. */
export function isBackupCode(code: SecondFactorCode): boolean {
  return code.includes('-');
}

/**
 * What `POST /v1/auth/sign-in/email` answers on success: the account (its session cookie is set), or, for an account
 * whose second factor is active and whose device is not trusted, `twoFactorRedirect` and no session: the page asks for
 * the code (`/v1/auth/two-factor/verify-totp` or `verify-backup-code`) before anything opens.
 */
export const SignInAnswerSchema = z.union([
  z.object({ twoFactorRedirect: z.literal(true) }),
  z.object({ user: z.object({ id: z.string() }) }),
]);
export type SignInAnswer = z.infer<typeof SignInAnswerSchema>;

/** `POST /v1/auth/two-factor/enable`: the password, once more, before a secret is made. */
export const SecondFactorEnableBodySchema = z.object({ password: GivenPasswordSchema });

/** What the activation answers: the `otpauth://` address the authenticator app reads, and ten backup codes, shown once. */
export const SecondFactorSetupSchema = z.object({
  totpURI: z.string().startsWith('otpauth://totp/'),
  backupCodes: z.array(z.string()).length(10),
});
export type SecondFactorSetup = z.infer<typeof SecondFactorSetupSchema>;

/**
 * `POST /v1/auth/two-factor/verify-totp` and `verify-backup-code`: the code, and whether this device is trusted for 30
 * days (ADR 0046 § 3). Answered at sign-in (the session opens) and, for `verify-totp` only, to finish the activation.
 */
export const SecondFactorVerifyBodySchema = z.object({
  code: SecondFactorCodeSchema,
  trustDevice: z.boolean().optional(),
});

/** `POST /v1/auth/two-factor/generate-backup-codes` (recent confirmation): ten new codes, the old ones stop working. */
export const BackupCodesSchema = z.object({ backupCodes: z.array(z.string()).length(10) });

/**
 * `POST /v1/auth/reauthenticate`: the password and a code, before a sensitive action (ADR 0046 § 3). Valid 10 minutes
 * on this session, trusted device or not.
 */
export const ReauthenticateBodySchema = z.object({
  password: GivenPasswordSchema,
  code: SecondFactorCodeSchema,
});
export type ReauthenticateBody = z.infer<typeof ReauthenticateBodySchema>;

/** Error code of every route but the activation's for an account whose second factor is not active yet (ADR 0046 § 1). */
export const SECOND_FACTOR_ERROR_CODE = 'second_factor_forbidden';

/** The codes of the sign-in, the second factor and the confirmation, besides `rate_limited` and `request_invalid`. */
export const AUTH_ERROR_CODES = [
  'session_unauthenticated',
  'sign_in_unauthenticated',
  'sign_in_limited',
  SECOND_FACTOR_ERROR_CODE,
  /** A wrong code (authenticator or backup). */
  'second_factor_unauthenticated',
  /** The code step of a sign-in expired, or ran out of tries: the sign-in starts over. */
  'second_factor_challenge_unauthenticated',
  /** Ten wrong codes in a row: the account's code is locked for 15 minutes. */
  'second_factor_limited',
  /** The second factor is already active: changing it goes through a reset. */
  'second_factor_conflict',
  /** A wrong password on the activation. */
  'password_unauthenticated',
  /** A wrong password or code on the confirmation; which of the two is not told. */
  'reauthentication_unauthenticated',
  'reauthentication_limited',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
