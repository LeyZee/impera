import type { NotificationPreferences, PushMessage, PushSubscriptionInput } from '@nirvana/contracts';

/** The server's current VAPID key pair (CR-01): made once, sealed in base, never typed by anyone (ADR 0016). */
export interface ServerKey {
  readonly id: string;
  readonly publicKey: Buffer;
  readonly privateKey: Buffer;
}

export interface ServerKeyStore {
  /** The current key, made and stored at the first call (two processes starting together keep one). */
  current(): Promise<ServerKey>;
}

/** A device of the account, as stored. */
interface StoredSubscription {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly serverKeyId: string;
}

export interface SubscriptionStore {
  /** Records the device under the account; a device that was another account's moves to this one. */
  save(userId: string, input: PushSubscriptionInput, serverKeyId: string): Promise<void>;
  /** Forgets one of the account's devices; another account's endpoint is left alone. */
  remove(userId: string, endpoint: string): Promise<void>;
  /** The account's devices made with the current key (an older key's subscription cannot be sent to). */
  listFor(userId: string, serverKeyId: string): Promise<readonly StoredSubscription[]>;
  /** A dead subscription (404, 410 from its push service). */
  drop(userId: string, id: string): Promise<void>;
  touch(userId: string, id: string): Promise<void>;
}

export interface PreferencesStore {
  get(userId: string): Promise<NotificationPreferences | null>;
  put(userId: string, preferences: NotificationPreferences): Promise<void>;
}

export type DeliveryOutcome = 'sent' | 'gone' | 'retry' | 'refused';

/** Sends one encrypted message to one device; never throws (a network error is `retry`). */
export interface PushSender {
  send(subscription: StoredSubscription, key: ServerKey, message: PushMessage): Promise<DeliveryOutcome>;
}
