import type {
  CreatorId,
  FanFlagName,
  FanFlags,
  FanId,
  PlatformAccountId,
  TeamScope,
  UserId,
} from '@nirvana/contracts';

import type { FactWrite, StoredFact } from './facts';
import type { FlagAuthor } from './flags';

/** A fan as the rest of the system sees it; her facts about him are read apart (`activeFacts`). */
export interface Fan {
  readonly id: FanId;
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly platformFanId: string;
  readonly displayName: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
}

export interface FanSighting {
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  /** The platform's own id for the fan, opaque to the core. */
  readonly platformFanId: string;
  readonly displayName: string;
  readonly seenAt: Date;
}

/** Storage port, implemented in `infra/` with `withTenant`. */
export interface FanStore {
  /** Creates the fan on first sight, otherwise refreshes its name and `last_seen_at`; idempotent. */
  upsert(sighting: FanSighting, newId: FanId): Promise<Fan>;
  get(creatorId: CreatorId, id: FanId): Promise<Fan | null>;
}

/** Storage of her facts about a fan, implemented in `infra/` with `withTenant`; append-only (data-model.md). */
export interface FactStore {
  /** Facts not superseded yet; the caller filters what has expired. */
  current(creatorId: CreatorId, fanId: FanId): Promise<StoredFact[]>;
  /** Plans and writes in one transaction, the fan locked so two writers never supersede the same fact twice. */
  write(
    creatorId: CreatorId,
    fanId: FanId,
    plan: (current: readonly StoredFact[]) => readonly FactWrite[],
  ): Promise<StoredFact[]>;
}

/** Retention across every creator (owner role, no tenant): facts of fans not seen since `cutoff` are dropped. */
export interface FactPurge {
  /** Deletes every fact of each fan last seen before `cutoff`, history included; returns how many. */
  dropFactsOfFansLastSeenBefore(cutoff: Date): Promise<number>;
}

/** A limit set or lifted, with who did it and why (`fan_flag_set` / `fan_flag_cleared`). */
interface FlagWrite {
  readonly type: 'fan_flag_set' | 'fan_flag_cleared';
  readonly flag: FanFlagName;
  readonly author: FlagAuthor;
  readonly reason?: string;
  readonly correlationId: string;
}

/**
 * His limits (`fans.flags`), implemented in `infra/` with `withTenant`, or `withTenantMember` when a person reads or
 * writes them: the team scope comes from the database in the same transaction, never from the caller.
 */
export interface FlagStore {
  read(creatorId: CreatorId, fanId: FanId): Promise<FanFlags>;
  /** His limits and the reader's team scope (`owner` | `agency` | `self`), read in one transaction. */
  readAs(creatorId: CreatorId, fanId: FanId, userId: UserId): Promise<{ flags: FanFlags; scope: TeamScope }>;
  /**
   * Locks the fan, applies `change` to his flags and, when they changed, writes them and the event in the same
   * transaction. Returns his flags after the call and the author's team scope, read in that same transaction: `change`
   * gets it when the author is a person (`human:<userId>`), `null` for the policy; a domain error it throws writes
   * nothing.
   */
  change(
    creatorId: CreatorId,
    fanId: FanId,
    change: (flags: FanFlags, scope: TeamScope | null) => FanFlags | null,
    event: FlagWrite,
  ): Promise<{ flags: FanFlags; scope: TeamScope | null }>;
}
