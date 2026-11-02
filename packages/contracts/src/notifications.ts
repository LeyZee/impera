import { z } from 'zod';

/**
 * Push notifications (CR-01, ADR 0042 § 7): a device's subscription, an account's preferences, and the message the
 * service worker shows. A message never carries a fan's name nor anything he wrote (ADR 0020): a locked screen is
 * read by anyone near the phone.
 */

/**
 * The push services a subscription may point at. The server sends a request to the endpoint a browser gave: any other
 * host would let a crafted subscription make the server call an address of its choosing.
 */
export const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  '.push.apple.com',
  '.notify.windows.com',
] as const;

export function isPushServiceUrl(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '')
    return false;
  return PUSH_SERVICE_HOSTS.some((host) =>
    host.startsWith('.') ? url.hostname.endsWith(host) : url.hostname === host,
  );
}

/** Bytes a base64url text decodes to (no Buffer: the web reads this contract too). */
function decodedLength(value: string): number {
  return Math.floor((value.replace(/=+$/u, '').length * 3) / 4);
}

const base64url = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+={0,2}$/u)
    .refine((value) => decodedLength(value) === bytes, `${String(bytes)} octets attendus`);

/** `PushSubscription.toJSON()` of the browser, as the page sends it. */
export const PushSubscriptionInputSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceUrl, 'Service de notification inconnu'),
  expirationTime: z.number().int().nonnegative().nullable().optional(),
  keys: z.object({
    /** The device's P-256 public key, uncompressed. */
    p256dh: base64url(65),
    /** The secret shared with the device. */
    auth: base64url(16),
  }),
});
export type PushSubscriptionInput = z.infer<typeof PushSubscriptionInputSchema>;

/** What the page needs before it asks the browser (iOS asks the person once): the server's public key. */
export const PushPublicKeySchema = z.object({ publicKey: base64url(65) });
export type PushPublicKey = z.infer<typeof PushPublicKeySchema>;

const DAY_MINUTES = 24 * 60;
const minuteOfDay = z
  .number()
  .int()
  .min(0)
  .max(DAY_MINUTES - 1);

/** An account's notification settings, in Moi › Notifications; start equal to end turns the quiet hours off. */
export const NotificationPreferencesSchema = z.object({
  quietHours: z.object({ startMinute: minuteOfDay, endMinute: minuteOfDay }),
  /** Rings a day for everything but sales and one's own shift start. */
  dailyCap: z.number().int().min(1).max(30),
});
export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;

export const PUSH_TITLE_MAX = 80;
export const PUSH_BODY_MAX = 180;

/** A path of the app, never another site: what the service worker opens on a touch. */
const AppPathSchema = z
  .string()
  .max(200)
  .refine(
    (path) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'),
    'Chemin de l’application',
  );

/** The message the server encrypts and the service worker shows (public/sw.js reads the same fields). */
export const PushMessageSchema = z.object({
  title: z.string().min(1).max(PUSH_TITLE_MAX),
  body: z.string().max(PUSH_BODY_MAX).optional(),
  url: AppPathSchema,
  /** A newer message with the same tag replaces the older one on the screen (a grouped burst of sales). */
  tag: z.string().max(64).optional(),
});
export type PushMessage = z.infer<typeof PushMessageSchema>;

/** `DELETE /v1/notifications/subscriptions`: the device to forget, by its endpoint. */
export const PushUnsubscribeBodySchema = z.object({ endpoint: z.string().max(2048) });
export type PushUnsubscribeBody = z.infer<typeof PushUnsubscribeBodySchema>;

/** `POST /v1/notifications/test`: how many of the account's devices the push services accepted. */
export const PushTestResultSchema = z.object({
  devices: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
});
export type PushTestResult = z.infer<typeof PushTestResultSchema>;

/**
 * What a notification is about (CR-01): the reason that makes it unique for an account with its object, and sets the
 * rules. A sale and the start of one's own shift are never capped; the start of one's own shift rings even in the
 * quiet hours. EQ-12, CR-04 and CR-13 bring their own.
 */
export const NOTIFICATION_REASONS = [
  'sale',
  'own_shift_start',
  'reminder',
  'routine',
  'streak',
  'team',
] as const;
export const NotificationReasonSchema = z.enum(NOTIFICATION_REASONS);
export type NotificationReason = z.infer<typeof NotificationReasonSchema>;

/**
 * A notification asked by another module: once only for an account, its reason and its object (`objectKey`: a sale's
 * id, a shift's id and day…), even replayed. `timeZone` is the account's own, for its quiet hours and its day.
 */
export const NotificationRequestSchema = z.object({
  userId: z.string().min(1),
  reason: NotificationReasonSchema,
  objectKey: z.string().min(1).max(200),
  timeZone: z.string().min(1),
  message: PushMessageSchema,
});
export type NotificationRequest = z.infer<typeof NotificationRequestSchema>;

/** What became of it: rung now, held for the recap, grouped with a burst of sales, silent past the cap, or already done. */
export type NotificationOutcome = 'rang' | 'held' | 'grouped' | 'silent' | 'duplicate';

export const NOTIFICATION_ERROR_CODES = [
  /** « Tester » with no device subscribed on this account. */
  'push_subscription_not_found',
] as const;
export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[number];
