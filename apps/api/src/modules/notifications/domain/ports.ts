import type {
  Currency,
  NotificationPreferences,
  NotificationRequest,
  PushMessage,
  PushSubscriptionInput,
} from '@nirvana/contracts';

import type { NotificationDecision } from './policy';

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

/** What the rules count, read in the transaction that records the notification. */
interface DeliveryFacts {
  readonly cappedRungToday: number;
  readonly salesInBurstWindow: number;
}

/** A notification the registry kept, with the decision it took. */
type RecordedDecision = NotificationDecision | { readonly action: 'duplicate' };

/**
 * `notification_deliveries`: once per account, reason and object (CR-01). `record` writes the request and its decision
 * in one transaction, one account at a time, and asks for the recap at the end of the quiet hours when it holds it.
 */
export interface DeliveryRegistry {
  record(
    request: NotificationRequest,
    at: Date,
    localDay: string,
    decide: (facts: DeliveryFacts) => NotificationDecision,
  ): Promise<RecordedDecision>;
  /** Marks the account's notifications held until `at` or before as recapped; how many there were. */
  takeHeld(userId: string, at: Date): Promise<number>;
}

/** A fresh sale to tell her (CRM-04 lot d2): her part and its currency, never who sold nor the fan. */
export interface CreatorSale {
  /** The register's line: the object of each account's notification, once per sale. */
  readonly saleId: string;
  readonly creatorMinor: number;
  readonly currency: Currency;
  /** Her creator's zone: her quiet hours and her day. */
  readonly timeZone: string;
  /** Her own accounts (role `creator`, linked to her creator alone); none yet is fine. */
  readonly accounts: readonly string[];
}

export interface CreatorSaleSource {
  /** The `sale_detected` of that id, read by the job's role; null when there is none. */
  saleOf(eventId: string): Promise<CreatorSale | null>;
}
