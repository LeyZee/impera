import type { StoredCaps } from './budget';

/** Who changes the budget, for `audit_log`: the guards have set the user. */
export interface BudgetActor {
  readonly userId: string;
  readonly ip: string;
}

/** The agency's one row of `ai_budget_settings`. */
export interface BudgetStore {
  /** The row, or no caps at all while the owner never set one. */
  read(): Promise<StoredCaps>;
  /** Writes both values and their `audit_log` line (before, after) in one transaction. */
  write(
    next: Pick<StoredCaps, 'dailyCapMinor' | 'trendWatchCapMinor'>,
    actor: BudgetActor,
  ): Promise<StoredCaps>;
}
