import { z } from 'zod';

import { REAUTHENTICATION_ERROR_CODE, UserRoleSchema } from './auth';
import { PlatformSchema } from './enums';
import { PlatformAccountIdSchema } from './ids';

/**
 * The security alerts (ADR 0046 § 8): told to the urgent Telegram groups, each after its own line of `audit_log`.
 * Never a fan's name, never a content, never a full IP address.
 */
export const SECURITY_ALERT_REASONS = [
  'new_device_sign_in',
  'sign_in_refusals',
  'second_factor_reset',
  'persona_activated',
  'automatic_enabled',
  'platform_session_replaced',
  'passkey_added',
  'passkey_new_sign_in',
] as const;
export const SecurityAlertReasonSchema = z.enum(SECURITY_ALERT_REASONS);
export type SecurityAlertReason = z.infer<typeof SecurityAlertReasonSchema>;

/** Refusals of a password, a code or a passkey on one account that make an alert, and the window they are counted in. */
export const SIGN_IN_REFUSALS_ALERT_AT = 5;
export const SIGN_IN_REFUSALS_WINDOW_MINUTES = 15;

/** An address cut to its network (`networkOf`): `203.0.113.x`, or an IPv6 `/48`. */
const NetworkSchema = z.string().min(1).max(64);

/** The account an alert is about, by id and role: never its name. Null for the command line, or an unknown account. */
const account = {
  userId: z.string().min(1).nullable(),
  role: UserRoleSchema.nullable(),
  /** Where the request came from, cut to its network; null when the act had no request (the command line). */
  network: NetworkSchema.nullable(),
};

/** Who did it from the dashboard, by id; null from the command line. */
const actor = { userId: z.string().min(1).nullable() };

export const SecurityAlertPayloadSchema = z.discriminatedUnion('reason', [
  /** The owner's account signed in from a device that was not trusted: a code was asked, or none was set yet. */
  z.object({ reason: z.literal('new_device_sign_in'), ...account }),
  /** Refusals of a password, a code or a passkey on one account reached the threshold within the window. */
  z.object({
    reason: z.literal('sign_in_refusals'),
    ...account,
    refusals: z.number().int().min(1),
    windowMinutes: z.number().int().min(1),
  }),
  /** A second factor that was active was put back to zero: by a reset link, or the server's command. */
  z.object({
    reason: z.literal('second_factor_reset'),
    ...account,
    via: z.enum(['invitation_link', 'ops']),
  }),
  /** A passkey was added to an account (ADR 0053 § 7): a lasting way in, like a second factor set up anew. */
  z.object({ reason: z.literal('passkey_added'), ...account }),
  /** The owner's account signed in with a passkey never used before (ADR 0053 § 7). */
  z.object({ reason: z.literal('passkey_new_sign_in'), ...account }),
  /** Another version of her persona became the active one. */
  z.object({ reason: z.literal('persona_activated'), ...actor, version: z.string().min(1).max(64) }),
  /** Automatique was switched on: for all her conversations, or for one. */
  z.object({
    reason: z.literal('automatic_enabled'),
    ...actor,
    scope: z.enum(['creator', 'conversation']),
  }),
  /** A valid platform session was replaced by a different one. */
  z.object({
    reason: z.literal('platform_session_replaced'),
    ...actor,
    platformAccountId: PlatformAccountIdSchema,
    platform: PlatformSchema,
  }),
]);
export type SecurityAlertPayload = z.infer<typeof SecurityAlertPayloadSchema>;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;
const HEXTET = /^[0-9a-f]{1,4}$/iu;

/**
 * An address cut to its network (ADR 0046 § 8: never a full IP in an alert): the first three bytes of an IPv4
 * (`203.0.113.x`), the first three groups of an IPv6 (`2001:db8:0::/48`). Null for anything that is not an address.
 */
export function networkOf(ip: string | null | undefined): string | null {
  if (ip === null || ip === undefined) return null;
  const address = ip.trim().replace(/^::ffff:/iu, '');
  const v4 = IPV4.exec(address);
  if (v4 !== null) {
    const bytes = v4.slice(1, 4);
    if ([...bytes, v4[4] ?? ''].some((byte) => Number(byte) > 255)) return null;
    return `${bytes.map(Number).join('.')}.x`;
  }
  const groups = ipv6Groups(address);
  return groups === null ? null : `${groups.slice(0, 3).join(':')}::/48`;
}

/** The eight groups of an IPv6 address, lowercase and without leading zeros; null if it is not one. */
function ipv6Groups(address: string): string[] | null {
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const [head = '', tail] = halves;
  const split = (part: string) => (part === '' ? [] : part.split(':'));
  const left = split(head);
  const right = tail === undefined ? [] : split(tail);
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right];
  if (!groups.every((group) => HEXTET.test(group))) return null;
  return groups.map((group) => parseInt(group, 16).toString(16));
}

/**
 * One of the signed-in person's open sessions (ADR 0046 § 7), as Réglages › Sécurité lists them: its device read from
 * the browser, its network (never the full address), when it opened and when it was last used. `id` is the session's
 * row, never its token.
 */
export const OpenSessionSchema = z.object({
  id: z.string().min(1),
  device: z.string().min(1),
  network: NetworkSchema.nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  /** The session this request came with: it is closed by signing out, never from the list. */
  current: z.boolean(),
});
export type OpenSession = z.infer<typeof OpenSessionSchema>;
export const OpenSessionsSchema = z.object({ sessions: z.array(OpenSessionSchema) });
export type OpenSessions = z.infer<typeof OpenSessionsSchema>;

/** What closing sessions ended: the sessions, and the trusted devices forgotten with them. */
export const ClosedSessionsSchema = z.object({
  sessions: z.number().int().min(0),
  trustedDevices: z.number().int().min(0),
});
export type ClosedSessions = z.infer<typeof ClosedSessionsSchema>;

/** For the owner (ADR 0046 § 7): each account's second factor and open sessions, never their devices or networks. */
export const AccountSecuritySchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  role: UserRoleSchema,
  secondFactor: z.boolean(),
  sessions: z.number().int().min(0),
  /** Its passkeys (ADR 0053 § 5): how many, never which device. */
  passkeys: z.number().int().min(0),
  lastActiveAt: z.iso.datetime().nullable(),
});
export type AccountSecurity = z.infer<typeof AccountSecuritySchema>;
export const AccountsSecuritySchema = z.object({ accounts: z.array(AccountSecuritySchema) });
export type AccountsSecurity = z.infer<typeof AccountsSecuritySchema>;

/**
 * The error codes of Réglages › Sécurité, besides those of the confirmation (`reauthentication_unauthenticated`,
 * `reauthentication_limited`) on new backup codes.
 */
export const SECURITY_SETTINGS_ERROR_CODES = [
  'session_not_found',
  'session_current_conflict',
  'account_not_found',
  'account_current_conflict',
  REAUTHENTICATION_ERROR_CODE,
] as const;
export type SecuritySettingsErrorCode = (typeof SECURITY_SETTINGS_ERROR_CODES)[number];

const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//u, 'Edge'],
  [/\b(?:OPR|Opera)\//u, 'Opera'],
  [/\bSamsungBrowser\//u, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//u, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//u, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//u, 'Safari'],
];
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b/u, 'iPhone'],
  [/\biPad\b/u, 'iPad'],
  [/\bAndroid\b/u, 'Android'],
  [/\bWindows\b/u, 'Windows'],
  [/\bMac OS X\b|\bMacintosh\b/u, 'Mac'],
  [/\bCrOS\b/u, 'ChromeOS'],
  [/\bLinux\b/u, 'Linux'],
];

/**
 * A device as a person recognises it, from its browser's `User-Agent`: « Chrome sur Windows », « Safari sur iPhone ».
 * What cannot be read says « Appareil inconnu »; nothing of the string itself is shown.
 */
export function deviceOf(userAgent: string | null | undefined): string {
  if (userAgent === null || userAgent === undefined) return 'Appareil inconnu';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser !== undefined && system !== undefined) return `${browser} sur ${system}`;
  return browser ?? system ?? 'Appareil inconnu';
}
