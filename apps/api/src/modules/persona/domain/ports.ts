import type {
  AgentHours,
  AgentHoursView,
  ArchivedCreator,
  CreatorId,
  CreatorSummary,
  NewCreator,
} from '@impera/contracts';

/** The creators table, the tenant root: no RLS of its own, read and written by the application role. */
export interface CreatorDirectory {
  /**
   * Every creator when `ids` is `'all'`, the given ones otherwise, archived ones included: what her history reads
   * (pay, reports, past shifts keep her name, ADR 0071 § 2). Ordered by name.
   */
  list(ids: readonly CreatorId[] | 'all'): Promise<readonly CreatorSummary[]>;
  /** `list` without the archived creators: what a list, a picker or a summary shows (ADR 0071 § 2). */
  unarchived(ids: readonly CreatorId[] | 'all'): Promise<readonly CreatorSummary[]>;
  /** The archived creators, the most recently archived first (ADR 0071 § 2). */
  archived(): Promise<readonly ArchivedCreator[]>;
  /**
   * Archives her (ADR 0071 § 2), audited with the owner (`creator.archive`); nothing of hers is deleted. Already
   * archived, nothing is written. `null` when she does not exist. Whether she is still planned is checked before, by
   * the caller.
   */
  archive(id: CreatorId, userId: string): Promise<ArchivedCreator | null>;
  /** Reopens her (`creator.restore`): she is listed again, her agent still off. `null` when she does not exist. */
  restore(id: CreatorId, userId: string): Promise<CreatorSummary | null>;
  /** Audited with `userId`, the owner who added her from the dashboard; none from `pnpm creator:create`. */
  create(input: NewCreator, userId?: string): Promise<CreatorSummary>;
  /**
   * Moves her to another zone, written as the runtime spells it, audited with the owner (`creator.timezone`, the zone
   * before and after), and moves her `conversation.reopen` to her next opening on the new clock in the same
   * transaction; nothing behind her is computed again. Unchanged, nothing is written. `null` when she does not exist.
   */
  setTimezone(id: CreatorId, timezone: string, userId: string): Promise<CreatorSummary | null>;
  /**
   * Renames her (ADR 0071 § 1), audited with the owner (`creator.rename`, the name before and after). Only her name
   * changes: her platform handles and her persona stay as they are. Unchanged, nothing is written. `null` when she does
   * not exist; `CreatorNameConflict` when another creator has this name.
   */
  rename(id: CreatorId, displayName: string, userId: string): Promise<CreatorSummary | null>;
  /**
   * Her hours (P3-14) on her clock; `null` when she does not exist. No setting, or one that no longer reads as
   * `AgentHours` (`invalidStored`), reads as the defaults: today's behaviour, never a silent stop.
   */
  agentHours(id: CreatorId): Promise<AgentHoursView | null>;
  /**
   * Stores her hours, `null` for the defaults, audited with the owner who set them, and moves her `conversation.reopen`
   * to her next opening under them in the same transaction; `false` when she does not exist.
   */
  setAgentHours(id: CreatorId, hours: AgentHours | null, userId: string): Promise<boolean>;
}
