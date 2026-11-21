import { AUDIT_CATEGORY_NAMES, type AuditEntry } from '@impera/contracts';

/** The export's columns, in French: the accountant or a lawyer reads them. */
export const AUDIT_CSV_COLUMNS = [
  'Identifiant',
  'Date (UTC)',
  'Auteur',
  'Compte',
  'Catégorie',
  'Action',
  'Geste',
  'Objet',
  'Identifiant de l’objet',
] as const;

/**
 * A cell: on one line, always quoted, its quotes doubled, and never read as a formula by a spreadsheet (a leading `=`,
 * `+`, `-`, `@`, tab or carriage return takes an apostrophe: OWASP « CSV injection »). A name or an action's raw text
 * written by someone else goes through here like any other.
 */
export function csvCell(value: string): string {
  const line = value.replace(/[\r\n]+/gu, ' ');
  const safe = /^[=+\-@\t\r]/u.test(value) ? `'${line}` : line;
  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * The selection as a file: the columns' names, then one line per entry in the page's order, separated by semicolons,
 * lines ended by CRLF, in UTF-8 with its byte order mark so that a spreadsheet reads its accents.
 */
export function auditCsv(entries: readonly AuditEntry[]): string {
  const lines = entries.map((entry) =>
    [
      entry.id,
      entry.at,
      entry.author === null ? 'Impera' : (entry.author.name ?? ''),
      entry.author?.userId ?? '',
      AUDIT_CATEGORY_NAMES[entry.category],
      entry.action,
      entry.label,
      entry.link?.kind ?? '',
      entry.link?.id ?? '',
    ]
      .map(csvCell)
      .join(';'),
  );
  return `\uFEFF${[AUDIT_CSV_COLUMNS.map(csvCell).join(';'), ...lines].join('\r\n')}\r\n`;
}
