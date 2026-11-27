import {
  AUDIT_EXPORT_MAX,
  AuditEntrySchema,
  auditNameRefs,
  describeAuditEntry,
  type AuditEntry,
  type AuditExportQuery,
  type AuditPage,
  type AuditQuery,
} from '@impera/contracts';

import { auditCsv } from '../domain/csv';
import { AuditExportUnprocessable } from '../domain/errors';
import type { AuditActor, AuditPosition, AuditSelection, AuditStore, StoredAuditRow } from '../domain/ports';

export interface AuditJournalDeps {
  readonly store: AuditStore;
  /** The opaque cursor of a position, and back (`null` for one this server did not give). */
  readonly cursor: {
    readonly encode: (position: AuditPosition) => string;
    readonly decode: (cursor: string) => AuditPosition;
  };
}

const selectionOf = (query: AuditExportQuery): AuditSelection => ({
  userId: query.userId,
  category: query.category,
  from: query.from === undefined ? undefined : new Date(query.from),
  to: query.to === undefined ? undefined : new Date(query.to),
});

/** Each line as the screen shows it, the names of a whole page read at once. */
async function entriesOf(store: AuditStore, rows: readonly StoredAuditRow[]): Promise<AuditEntry[]> {
  const names = await store.namesUnscoped([...new Set(rows.flatMap(auditNameRefs))]);
  return rows.map((row) => {
    const described = describeAuditEntry(row, names);
    return AuditEntrySchema.parse({
      id: row.id,
      at: row.at.toISOString(),
      author: row.userId === null ? null : { userId: row.userId, name: row.authorName },
      action: row.action,
      ...described,
    });
  });
}

/**
 * `GET /v1/audit`: one page, newest first. The cursor is the last line's place in `(created_at, id)`: a line written
 * while the owner reads lands before the first page, never inside the ones still to come.
 */
export async function readJournalPage(deps: AuditJournalDeps, query: AuditQuery): Promise<AuditPage> {
  const after = query.cursor === undefined ? null : deps.cursor.decode(query.cursor);
  const rows = await deps.store.rowsUnscoped(selectionOf(query), after, query.limit + 1);
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await entriesOf(deps.store, page),
    nextCursor: rows.length > query.limit && last !== undefined ? deps.cursor.encode(last.position) : null,
  };
}

/**
 * `GET /v1/audit.csv`: every line of the selection, `AUDIT_EXPORT_MAX` at most, then its own line in the journal (who
 * took how many lines), written once the file is ready.
 */
export async function exportJournal(
  deps: AuditJournalDeps,
  query: AuditExportQuery,
  actor: AuditActor,
): Promise<string> {
  const rows = await deps.store.rowsUnscoped(selectionOf(query), null, AUDIT_EXPORT_MAX + 1);
  if (rows.length > AUDIT_EXPORT_MAX) throw new AuditExportUnprocessable();
  const file = auditCsv(await entriesOf(deps.store, rows));
  await deps.store.recordExportUnscoped(actor, rows.length);
  return file;
}
