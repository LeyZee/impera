import type { DetectedLink, LinkServiceFailure } from '@impera/contracts';

import type { KeyActor } from './sales-feed';

/**
 * A refusal or an outage of the redirect service (ADR 0120 § 3). Its message is the kind and nothing else: neither
 * the host, the key nor a word of the service's answer can reach a log, an API answer or `audit_log` through it.
 */
export class LinkServiceError extends Error {
  constructor(
    readonly kind: LinkServiceFailure,
    /** Seconds the service asks to wait, when it says so. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`link service: ${kind}`);
    this.name = 'LinkServiceError';
  }
}

/** The redirect service read with one key. It has nothing that writes to the service. */
export interface LinkServiceReader {
  /** Resolves when the service accepts the key; throws a `LinkServiceError` otherwise. */
  ping(): Promise<void>;
  /** Every link of the account: how the service names it, its name there, its address. Nothing else. */
  listLinks(): Promise<readonly DetectedLink[]>;
}

/** The agency's saved key; `key` is `null` when no listed encryption key opens it any more. */
interface StoredLinkServiceKey {
  readonly key: string | null;
  readonly connectedAt: Date;
}

/**
 * Where the agency's key of the redirect service is kept, sealed. `find` is for the reading of the links and for the
 * state shown in the settings, which never carries the key. `save` and `remove` are the owner's gestures, each with
 * its line in `audit_log`; no job calls them.
 */
export interface LinkServiceKeyStore {
  find(): Promise<StoredLinkServiceKey | null>;
  save(key: string, at: Date, by: KeyActor): Promise<void>;
  /** Whether a key was there. */
  remove(by: KeyActor): Promise<boolean>;
}
