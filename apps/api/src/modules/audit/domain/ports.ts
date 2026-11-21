import type { AuditCategory, AuditNames, AuditRow } from '@impera/contracts';

/** The lines a page or an export reads: by author, by category, in `[from, to)`. */
export interface AuditSelection {
  readonly userId?: string | undefined;
  readonly category?: AuditCategory | undefined;
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
}

/**
 * Where a page ends: the line's `created_at` to the microsecond, as Postgres keeps it (a `Date` would lose three
 * digits and skip or repeat a line written in the same millisecond), and its id.
 */
export interface AuditPosition {
  readonly at: string;
  readonly id: string;
}

/** A line of `audit_log` as the store reads it, its author's name beside it when the base knows one. */
export interface StoredAuditRow extends AuditRow {
  readonly id: string;
  readonly at: Date;
  readonly position: AuditPosition;
  readonly userId: string | null;
  readonly authorName: string | null;
}

/** Who exported the journal, for its own line. */
export interface AuditActor {
  readonly userId: string;
  readonly ip: string;
}

/**
 * `audit_log` and the names it shows, read on the service connection (`withAdmin`): the table is out of RLS and the
 * owner reads every line (`packages/db/README.md`). Each method is named `*Unscoped` for that reason.
 */
export interface AuditStore {
  /** At most `limit` lines of the selection, newest first, strictly after `after` in that order. */
  rowsUnscoped(
    selection: AuditSelection,
    after: AuditPosition | null,
    limit: number,
  ): Promise<readonly StoredAuditRow[]>;
  /** The display names of the members' records and of the creators among `ids`. */
  namesUnscoped(ids: readonly string[]): Promise<AuditNames>;
  /** The export's own line (`audit.export`): who took how many lines. */
  recordExportUnscoped(actor: AuditActor, rows: number): Promise<void>;
}
