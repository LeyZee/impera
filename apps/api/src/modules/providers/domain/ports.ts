import type { AiProvider } from '@impera/contracts';

import type { NewCredential, StoredCredential } from './credential';

/** Saved keys. The Postgres adapter encrypts `key` with CREDENTIALS_ENCRYPTION_KEYS (ADR 0016). */
export interface CredentialStore {
  find(provider: AiProvider): Promise<StoredCredential | null>;
  list(): Promise<readonly StoredCredential[]>;
  /**
   * A connection or a replacement: writes the whole row, key included, whatever was there, and an `audit_log` line
   * (connected or replaced) in the same transaction, naming who did it and a short fingerprint, never the key.
   */
  save(credential: NewCredential, by?: KeyActor): Promise<void>;
  /**
   * A check, a refusal seen in production or a new setting: writes the state and the settings, never the key, and
   * only if the row is still at `credential.revision`. False when it changed or went away meanwhile (a replacement
   * or a disconnection during a 15-minute check must win).
   */
  update(credential: StoredCredential): Promise<boolean>;
  /** A disconnection, with its `audit_log` line when there was a key to remove. */
  remove(provider: AiProvider, by?: KeyActor): Promise<void>;
}

/** Who connected, replaced or removed a key: the signed-in owner and her address; nobody for a script or a test. */
export interface KeyActor {
  readonly userId: string | null;
  readonly ip: string | null;
}

export interface Clock {
  now(): Date;
}
