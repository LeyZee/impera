import type { AgentHours, AgentHoursView, CreatorId, CreatorSummary, NewCreator } from '@nirvana/contracts';

/** The creators table, the tenant root: no RLS of its own, read and written by the application role. */
export interface CreatorDirectory {
  /** Every creator when `ids` is `'all'` (an owner), the given ones otherwise; ordered by name. */
  list(ids: readonly CreatorId[] | 'all'): Promise<readonly CreatorSummary[]>;
  /** Audited with `userId`, the owner who added her from the dashboard; none from `pnpm creator:create`. */
  create(input: NewCreator, userId?: string): Promise<CreatorSummary>;
  /**
   * Moves her to another zone, written as the runtime spells it, audited with the owner (`creator.timezone`, the zone
   * before and after), and moves her `conversation.reopen` to her next opening on the new clock in the same
   * transaction; nothing behind her is computed again. Unchanged, nothing is written. `null` when she does not exist.
   */
  setTimezone(id: CreatorId, timezone: string, userId: string): Promise<CreatorSummary | null>;
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
