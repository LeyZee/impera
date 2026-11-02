import { PushPublicKeySchema, PushSubscriptionInputSchema } from '@nirvana/contracts';

import { isStandalone, platformOf } from './install';

/**
 * This device's push subscription (CR-01 lot b), seen from the page. The rules that decide what rings live on the
 * server; here, only asking, subscribing and telling the server.
 *
 * - An iPhone receives notifications only in the installed app, and asks the person once: the request leaves only
 *   from a touch on « Activer », never on its own at opening.
 * - The server's key is read when the screen opens (`readServerKey`), never between the touch and the question: iOS
 *   accepts the request only while the touch still counts, and a network round trip can spend it. A key renewed in
 *   Réglages makes every device subscribe again at its next opening (`refreshPushSubscription`).
 */

export type PushState =
  /** The browser has no Web Push. */
  | 'unsupported'
  /** An iPhone in Safari: notifications need the installed app first (/aide/installer). */
  | 'needs_install'
  /** Refused in the browser's settings: only the person can change it there. */
  | 'denied'
  /** Allowed or not yet asked, and no subscription. */
  | 'off'
  | 'on';

export const PUSH_KEY_URL = '/v1/notifications/push-key';
export const PUSH_SUBSCRIPTIONS_URL = '/v1/notifications/subscriptions';

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const binary = window.atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (a?.byteLength !== b.length) return false;
  const left = new Uint8Array(a);
  return left.every((byte, index) => byte === b[index]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

/** What can be known without waiting: everything but whether a subscription exists. */
function blockedState(): 'needs_install' | 'unsupported' | 'denied' | null {
  if (platformOf(navigator.userAgent, navigator.maxTouchPoints) === 'ios' && !isStandalone())
    return 'needs_install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return null;
}

export async function pushState(): Promise<PushState> {
  const blocked = blockedState();
  if (blocked !== null) return blocked;
  try {
    return (await currentSubscription()) === null ? 'off' : 'on';
  } catch {
    return 'off';
  }
}

/** The server's public key, read before the touch on « Activer » (see above). */
export async function readServerKey(): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(PUSH_KEY_URL, { credentials: 'include' });
  if (!response.ok) throw new Error(`push_key_${String(response.status)}`);
  return base64UrlToBytes(PushPublicKeySchema.parse(await response.json()).publicKey);
}

async function tellServer(subscription: PushSubscription): Promise<void> {
  const body = PushSubscriptionInputSchema.parse(subscription.toJSON());
  const response = await fetch(PUSH_SUBSCRIPTIONS_URL, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`push_subscription_${String(response.status)}`);
}

async function subscribe(key: Uint8Array<ArrayBuffer>): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  await tellServer(subscription);
}

export type TurnOnOutcome = 'on' | 'denied' | 'unsupported' | 'needs_install' | 'failed';

/**
 * « Activer les notifications », from the person's touch, with the server's key already read: the question leaves
 * first, before any wait, or iOS may refuse it (and it asks only once). Without the key, the button is not offered:
 * asking, then failing to subscribe, would spend that one question.
 */
export async function turnOnPush(key: Uint8Array<ArrayBuffer>): Promise<TurnOnOutcome> {
  const blocked = blockedState();
  if (blocked !== null) return blocked;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'failed';
    await subscribe(key);
    return 'on';
  } catch {
    return 'failed';
  }
}

/**
 * At each opening, once allowed: the subscription made with an older server key is replaced, and the server is told
 * again (a lost answer, a subscription it dropped). Silent: nothing to say to the person when it fails.
 */
export async function refreshPushSubscription(): Promise<void> {
  try {
    if ((await pushState()) !== 'on' || Notification.permission !== 'granted') return;
    const subscription = await currentSubscription();
    if (subscription === null) return;
    const key = await readServerKey();
    if (sameBytes(subscription.options.applicationServerKey, key)) {
      await tellServer(subscription);
      return;
    }
    await subscription.unsubscribe();
    await subscribe(key);
  } catch {
    // Tried again at the next opening.
  }
}

/** « Désactiver » in Moi, and before a sign-out: the server forgets this device, then the browser does. */
export async function turnOffPush(): Promise<void> {
  try {
    const subscription = await currentSubscription();
    if (subscription === null) return;
    await fetch(PUSH_SUBSCRIPTIONS_URL, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // Nothing to undo: the server drops a dead subscription at its first refused send (410).
  }
}
