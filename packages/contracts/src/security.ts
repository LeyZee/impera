import { z } from 'zod';

import { UserRoleSchema } from './auth';
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
] as const;
export const SecurityAlertReasonSchema = z.enum(SECURITY_ALERT_REASONS);
export type SecurityAlertReason = z.infer<typeof SecurityAlertReasonSchema>;

/** Refusals of a password or a code on one account that make an alert, and the window they are counted in. */
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
  /** Refusals of a password or a code on one account reached the threshold within the window. */
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
