import type {
  ConnectorConfig,
  CreatorId,
  EventBody,
  ExternalMessage,
  Platform,
  PlatformAccountId,
  SessionState,
} from '@nirvana/contracts';

import type { PlatformConnector } from './platform-connector';
import type { BreakerState } from './rhythm';

export interface Clock {
  now(): Date;
}

/** A platform account as the connectors see it (`platform_accounts`, never its session). */
export interface ConnectorAccount extends BreakerState {
  readonly id: PlatformAccountId;
  readonly creatorId: CreatorId;
  readonly platform: Platform;
  readonly sessionState: SessionState;
  readonly lastPollAt: Date | null;
  readonly config: ConnectorConfig;
}

/** Builds the connector of one account from its decrypted session (`null` when none was captured). */
type ConnectorFactory = (account: ConnectorAccount, session: string | null) => PlatformConnector;

/** One factory per platform that has an adapter; an account whose platform has none is never polled. */
export type ConnectorRegistry = Partial<Record<Platform, ConnectorFactory>>;

/** Who wrote an event outside a conversation (`domain_events`). */
export interface EventMeta {
  readonly correlationId: string;
  readonly at: Date;
}

/** `platform_accounts` and the account-level events. Tenant methods run under RLS. */
export interface AccountStore {
  /** Every account the dispatcher may poll, all creators (owner role). */
  listPollable(platforms: readonly Platform[]): Promise<ConnectorAccount[]>;
  /** Unscoped lookup of an account's creator, for the device-token route (owner role). */
  creatorOf(id: PlatformAccountId): Promise<CreatorId | null>;
  get(creatorId: CreatorId, id: PlatformAccountId): Promise<ConnectorAccount | null>;
  /** The encrypted session, or `null`. */
  sessionOf(creatorId: CreatorId, id: PlatformAccountId): Promise<Buffer | null>;
  recordPoll(creatorId: CreatorId, id: PlatformAccountId, at: Date): Promise<void>;
  recordFailure(creatorId: CreatorId, id: PlatformAccountId, state: BreakerState): Promise<void>;
  /** Sets the state and publishes `session_state_changed` in one transaction; no event when it did not change. */
  setSessionState(
    creatorId: CreatorId,
    id: PlatformAccountId,
    to: SessionState,
    meta: EventMeta,
  ): Promise<void>;
  /**
   * Stores an encrypted session, sets the state to `valid` and closes the breaker. `session_updated_at` moves only for
   * a new session: none was stored, the stored one is not `isSame`, or the state was `none` or `expired`. An identical
   * one sent again must not hide a read that is late (the Dashboard counts from the latest of the two dates).
   * `isSame` reads the stored ciphertext under the account's row lock, so two sends at once date it once.
   */
  storeSession(
    creatorId: CreatorId,
    id: PlatformAccountId,
    session: { readonly ciphertext: Buffer; readonly isSame: (stored: Buffer) => boolean },
    meta: EventMeta & { readonly userId: string | null },
  ): Promise<void>;
  publish(creatorId: CreatorId, body: EventBody, meta: EventMeta): Promise<void>;
}

/** Owner-role enqueue for jobs that start outside any business transaction (the dispatcher). */
export interface AccountJobs {
  enqueuePoll(account: ConnectorAccount, runAt: Date, correlationId: string): Promise<void>;
  enqueueReconcile(account: ConnectorAccount, correlationId: string): Promise<void>;
}

/** `conversations.ingestMessage`, injected by the composition root (connectors README). */
export type IngestMessage = (input: {
  creatorId: CreatorId;
  platformAccountId: PlatformAccountId;
  platformConversationId: string;
  platformFanId: string;
  fanDisplayName: string;
  message: ExternalMessage;
  correlationId: string;
}) => Promise<{ isNew: boolean }>;

/** What a job handler logs through; the composition root passes the job's own logger. */
export interface JobLogger {
  info(object: object, message: string): void;
  warn(object: object, message: string): void;
}

/** Seals and opens platform sessions (AES-256-GCM, bound to the account id); `null` when no key is configured. */
export interface SessionVault {
  seal(platformAccountId: PlatformAccountId, session: string): Buffer;
  open(platformAccountId: PlatformAccountId, sealed: Buffer): string;
}
