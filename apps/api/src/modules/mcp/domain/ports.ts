import type { CreatorId, McpCallRefusal, McpCapability, McpGrantId, UserId } from '@impera/contracts';

/** The owner at the screen, for what he does to his agent accesses (each gesture enters the audit log). */
export interface McpOwner {
  readonly userId: UserId;
  readonly ip: string;
}

/** An agent access as kept: never its token, its fingerprint stays in the store. */
export interface GrantRecord {
  readonly id: McpGrantId;
  readonly userId: UserId;
  readonly creatorId: CreatorId | null;
  readonly label: string;
  readonly capabilities: readonly McpCapability[];
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface NewGrant {
  readonly id: McpGrantId;
  readonly label: string;
  readonly creatorId: CreatorId | null;
  readonly capabilities: readonly McpCapability[];
  readonly tokenHash: string;
  /** Days from its creation, counted on the base's clock with its `created_at` (`mcp_grants_expires_check`). */
  readonly days: number;
}

/**
 * `mcp_grants` (migration 0193): the owner's, inside `withMember`; the token's access by the service role only. The
 * policies read the scope `owner`, not the person: any owner lists and revokes every access (one owner today).
 */
export interface McpGrantStore {
  /** His accesses, the newest first, revoked and expired ones included. */
  list(owner: McpOwner): Promise<readonly GrantRecord[]>;
  /** In his own name, with its audit line. */
  create(owner: McpOwner, grant: NewGrant): Promise<GrantRecord>;
  /** `false` for an access he has not, or already revoked. */
  revoke(owner: McpOwner, id: McpGrantId): Promise<boolean>;
  /**
   * The live access of a fingerprint (not revoked, not expired), out of any person: the one read that crosses
   * (ADR 0026 § 3, ADR 0087), by the service role in read only. `null` for anything else.
   */
  findByTokenHashUnscoped(tokenHash: string): Promise<GrantRecord | null>;
  /**
   * Its last use, written as the person it acts for, never by the service role (ADR 0105 § 5). `false` when no row was
   * written: the person may no longer write it (no longer the owner), and the access then serves nothing.
   */
  touch(userId: UserId, id: McpGrantId): Promise<boolean>;
}

/** A new token and its fingerprint; the token itself is shown once and kept nowhere. */
export interface MintedToken {
  readonly token: string;
  readonly hash: string;
}

/**
 * One line of the journal for each call of a tool, read included (ADR 0026 § 8): the person, the access, the tool, the
 * outcome, the creator the call was confined to. Never a text, an argument or the token. Written as the person, never
 * by the service role (ADR 0105 § 5).
 */
export interface McpCallRecord {
  readonly userId: UserId;
  readonly grantId: McpGrantId;
  /** A name of the catalogue, or `null` for a name outside it (never written as given). */
  readonly tool: string | null;
  readonly outcome: 'ok' | McpCallRefusal | 'error';
  readonly creatorId: string | null;
  readonly requestId: string;
  readonly ip: string;
}

export interface McpJournal {
  record(entry: McpCallRecord): Promise<void>;
}
