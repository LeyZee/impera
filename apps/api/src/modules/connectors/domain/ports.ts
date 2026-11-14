import type {
  ConnectorConfig,
  CreatorId,
  EventBody,
  ExternalMessage,
  Platform,
  PlatformAccountId,
  SessionState,
} from '@impera/contracts';

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

/**
 * One attempt to send, as `connector_sends` keeps it (reveal-connector-spec.md § 5): recorded before the platform is
 * called, given the platform's message id once known. Never the text: only its fingerprint.
 */
export interface ConnectorSend {
  readonly idempotencyKey: string;
  readonly platformConversationId: string;
  /** SHA-256 (hex) of the text, the script step and the media sent. */
  readonly fingerprint: string;
  /** The platform's step, for a script step: what the fingerprint was computed with. */
  readonly scriptRef: string | null;
  /** When the first attempt started, by our clock. */
  readonly startedAt: Date;
  /** `null` while the outcome is unknown (`pending`). */
  readonly platformMessageId: string | null;
  readonly sentAt: Date | null;
}

/** `connector_sends` of one account, under its creator's RLS. */
export interface SendJournal {
  find(idempotencyKey: string): Promise<ConnectorSend | null>;
  /** Records the attempt before the call; an existing row of this key is left as it is and returned. */
  begin(send: Omit<ConnectorSend, 'platformMessageId' | 'sentAt'>): Promise<ConnectorSend>;
  /** The platform took it: its message id, once. */
  settle(idempotencyKey: string, platformMessageId: string, sentAt: Date): Promise<void>;
  /** Which of these platform message ids are sends of ours, in this conversation. */
  ownIds(platformConversationId: string, platformMessageIds: readonly string[]): Promise<ReadonlySet<string>>;
}

/** What the module gives an adapter besides its session: its account's send journal. */
interface ConnectorContext {
  readonly sends: SendJournal;
}

/** Builds the connector of one account from its decrypted session (`null` when none was captured). */
type ConnectorFactory = (
  account: ConnectorAccount,
  session: string | null,
  context: ConnectorContext,
) => PlatformConnector;

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
  /** Unscoped lookup of an account's creator and platform, for the extension's route (owner role). */
  creatorOf(
    id: PlatformAccountId,
  ): Promise<{ readonly creatorId: CreatorId; readonly platform: Platform } | null>;
  /** Every account of a platform, all creators, with her name: the owner's « Sync » list (owner role). */
  listSyncable(platform: Platform): Promise<SyncableAccount[]>;
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

/**
 * Reads a captured session's shape, platform by platform: `null` when the text is not a session of this platform, else
 * whose it is (`owner`: on Reveal, the creator's model id). Two sessions of one account must have the same owner.
 */
export type SessionShape = (raw: string) => { readonly owner: string; readonly member?: string } | null;

/** One reader per platform whose sessions the extension captures; a platform without one takes no session. */
export type SessionShapes = Partial<Record<Platform, SessionShape>>;

/** An account the extension may sync, as the owner's popup lists it. */
interface SyncableAccount {
  readonly id: PlatformAccountId;
  readonly platform: Platform;
  readonly handle: string;
  readonly creatorName: string;
  readonly sessionState: SessionState;
  readonly sessionUpdatedAt: Date | null;
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
  /**
   * A message caught up rather than just received (the account's first poll, or one older than `CATCH_UP_AFTER_HOURS`):
   * stored, never answered nor read by the models on its own. The next fresh message of his starts both (P2-02).
   */
  catchUp: boolean;
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
