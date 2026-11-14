import type { CreatorId, FanId, McpCallRefusal, McpCapability, McpGrantId, UserId } from '@impera/contracts';

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
  /** The identifiers the call touched (a fan's id), never a name or a text. */
  readonly subject: Readonly<Record<string, string>>;
  readonly requestId: string;
  readonly ip: string;
}

export interface McpJournal {
  record(entry: McpCallRecord): Promise<void>;
}

/** A creator as the persona module lists her (`CreatorSummary`), what a tool keeps of her. */
export interface CreatorEntry {
  readonly id: string;
  readonly displayName: string;
  readonly timezone: string;
}

/**
 * The creators a person may read, by the persona module's directory (its `index.ts`, ADR 0026 § 1): archived ones
 * left out (ADR 0071 § 2), ordered by name. The call has already decided which ones.
 */
export interface CreatorReader {
  unarchived(ids: readonly CreatorId[] | 'all'): Promise<readonly CreatorEntry[]>;
}

/** A fan as the fans module gives him (`Fan`), what a tool keeps of him: never his platform's id. */
interface FanEntry {
  readonly id: string;
  readonly displayName: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

/** A fact about a fan (`StoredFact`), what a tool keeps of it: never the message it was read in. */
interface FanFactEntry {
  readonly category: string;
  readonly key: string;
  readonly value: string;
  readonly kind: string;
  readonly observedAt: Date;
}

/** A value of his card (`CardValue`), what a tool keeps of it. */
export interface CardValueEntry {
  readonly items: readonly string[];
  readonly source: string;
  readonly observedAt: Date;
  readonly notedByName: string | null;
}

/** His card (`Card`, ADR 0085), what a tool keeps of it. */
interface CardEntry {
  readonly fields: readonly {
    readonly field: string;
    readonly current: CardValueEntry | null;
    readonly toCheck: readonly unknown[];
  }[];
  readonly others: readonly {
    readonly key: string;
    readonly value: string;
    readonly source: string;
    readonly observedAt: Date;
  }[];
}

/**
 * The fans module's reads (its `index.ts`, ADR 0026 § 1), each bounded by the creator the call is confined to: a fan
 * of another creator is not found. Read as the owner or an active manager reads them; a member in `self` holds no
 * capability yet (ADR 0025).
 */
export interface FanReader {
  getFan(creatorId: CreatorId, fanId: FanId): Promise<FanEntry | null>;
  activeFacts(creatorId: CreatorId, fanId: FanId): Promise<readonly FanFactEntry[]>;
  flags(creatorId: CreatorId, fanId: FanId): Promise<unknown>;
  card(creatorId: CreatorId, fanId: FanId): Promise<CardEntry>;
}
