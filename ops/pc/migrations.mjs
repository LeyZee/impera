// What an update brings to the database (ADR 0125 § 2 and § 4): the migrations it adds, read from Drizzle's journal
// at two commits, and whether one of them could destroy data. Pure: the caller reads the files through git.

/** Where Drizzle keeps its journal and the SQL of each migration, from the repository root. */
export const MIGRATIONS_DIR = 'packages/db/migrations';
export const JOURNAL_PATH = `${MIGRATIONS_DIR}/meta/_journal.json`;

/**
 * What an unattended update must never run without the owner's word: statements that can lose data, and those that
 * lower a defence (row-level security turned off). The rule refuses by default and lets through only the forms known
 * to remove no rows, so a spelling it does not know is refused, never let through: a `DROP` is refused unless only
 * spaces separate it from CONSTRAINT, DEFAULT, NOT NULL, IDENTITY, EXPRESSION, INDEX, POLICY or TRIGGER (a comment
 * between the two refuses it too); `TRUNCATE` everywhere except in a GRANT or a REVOKE (the privilege of that name);
 * `DELETE` except as a foreign key's `ON DELETE`, a trigger's event (`… OR DELETE ON`, `TG_OP = 'DELETE'`), a policy's
 * `FOR DELETE` or a privilege. A word on a line that is a whole `--` comment is prose (a content « drop », « no DELETE »), unless the line
 * holds a quote, a `$` or a `*\/`; everywhere else, a comment at the end of a line included, the word counts, which
 * only costs a start on the present version and an alert, never data.
 *
 * No rule on text sees what loses data without these words (`UPDATE … SET`, `ALTER COLUMN … TYPE … USING`, SQL built
 * in an `EXECUTE`): this guard catches the accident; against the rest stand the review on main and the backup taken
 * first (ADR 0125 § 4).
 */
const DROP = /\bDROP\b/gi;
const DROP_KEEPS_ROWS = /^\s+(?:CONSTRAINT|DEFAULT|NOT\s+NULL|IDENTITY|EXPRESSION|INDEX|POLICY|TRIGGER)\b/i;
/** The word after a refused `DROP`, named in the journal when it is one of these; never a name from the SQL. */
const DROP_OBJECTS = new Set([
  'TABLE',
  'COLUMN',
  'SCHEMA',
  'DATABASE',
  'TYPE',
  'OWNED',
  'SEQUENCE',
  'EXTENSION',
  'MATERIALIZED',
  'VIEW',
  'FUNCTION',
  'DOMAIN',
  'ROLE',
]);
const TRUNCATE = /\bTRUNCATE\b/gi;
const DELETE = /\bDELETE\b/gi;
const RLS_OFF = /\b(?:DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i;

/**
 * Whether the word at `index` is prose: its line is a whole comment (`--` after spaces only) holding no quote, no `$`
 * and no `*\/`, so no string, `$$` body or block comment opened above can close on it and run the rest. A comment at
 * the end of a line of SQL counts as SQL: at worst one refusal too many.
 */
function inProse(sql, index) {
  const start = sql.lastIndexOf('\n', index - 1) + 1;
  const end = sql.indexOf('\n', index);
  const line = sql.slice(start, end === -1 ? sql.length : end);
  return /^\s*--/.test(line) && !/['"$]|\*\//.test(line);
}

/**
 * Whether the statement holding `index` is a GRANT or a REVOKE. It starts after the last `;` or the last Drizzle
 * `--> statement-breakpoint` line, the nearer of the two (a chunk between breakpoints needs no `;`), comment lines
 * aside.
 */
function inPrivilegeStatement(sql, index) {
  const before = sql.slice(0, index);
  const breakpoint = [...before.matchAll(/^[ \t]*--> statement-breakpoint[^\n]*$/gm)].at(-1);
  // A `;` on a whole comment line ends nothing.
  const code = before.replace(/^[ \t]*--[^\n]*$/gm, (line) => ' '.repeat(line.length));
  const start = Math.max(
    code.lastIndexOf(';') + 1,
    breakpoint === undefined ? 0 : breakpoint.index + breakpoint[0].length,
  );
  const statement = before
    .slice(start)
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n');
  return /^\s*(?:GRANT|REVOKE)\b/i.test(statement);
}

/**
 * The migration tags of a Drizzle journal, in order. Throws on anything else than the journal's own shape: a journal
 * the program cannot read stops the update, it never guesses.
 */
const TAG = /^[0-9]{4}_[a-z0-9_]+$/;

export function journalTags(text) {
  const journal = JSON.parse(text);
  if (journal === null || typeof journal !== 'object' || !Array.isArray(journal.entries)) {
    throw new Error('journal des migrations illisible');
  }
  return journal.entries.map((entry) => {
    // A tag goes into journal.log and a file path: only Drizzle's own shape is read.
    if (
      entry === null ||
      typeof entry !== 'object' ||
      typeof entry.tag !== 'string' ||
      !TAG.test(entry.tag)
    ) {
      throw new Error('journal des migrations illisible');
    }
    return entry.tag;
  });
}

/**
 * The migrations the new journal adds to the old one. A new journal shorter than the old is code behind the base,
 * which runs on it (migrations only add, ADR 0125 § 4): nothing to add. Two journals that differ on a migration they
 * both list mean history was rewritten: the update is refused (`rewritten`), never applied.
 */
export function migrationDiff(oldTags, newTags) {
  const shared = Math.min(oldTags.length, newTags.length);
  const rewritten = oldTags.slice(0, shared).some((tag, index) => newTags[index] !== tag);
  return { rewritten, added: rewritten ? [] : newTags.slice(oldTags.length) };
}

/** The refused statements of one migration's SQL, by kind, each once, in the order they first appear. */
export function destructiveKinds(sql) {
  const kinds = [];
  const add = (kind) => {
    if (!kinds.includes(kind)) kinds.push(kind);
  };
  for (const match of sql.matchAll(DROP)) {
    const after = sql.slice(match.index + match[0].length);
    if (DROP_KEEPS_ROWS.test(after) || inProse(sql, match.index)) continue;
    const word = /^\s+([A-Za-z]+)/.exec(after)?.[1]?.toUpperCase();
    add(word !== undefined && DROP_OBJECTS.has(word) ? `DROP ${word}` : 'DROP');
  }
  for (const match of sql.matchAll(TRUNCATE)) {
    if (!inPrivilegeStatement(sql, match.index) && !inProse(sql, match.index)) add('TRUNCATE');
  }
  for (const match of sql.matchAll(DELETE)) {
    const before = sql.slice(0, match.index);
    const after = sql.slice(match.index + match[0].length);
    const keepsRows =
      /\b(?:ON|FOR)\s+$/i.test(before) ||
      /^\s+(?:ON|OR)\b/i.test(after) ||
      (before.endsWith("'") && after.startsWith("'")) ||
      inPrivilegeStatement(sql, match.index) ||
      inProse(sql, match.index);
    if (!keepsRows) add('DELETE');
  }
  if (RLS_OFF.test(sql)) add('RLS OFF');
  return kinds;
}

/**
 * The added migrations that would be refused: destructive and not named in the owner's allowance
 * (`allowDestructiveMigrations` of the local config).
 */
export function refusedMigrations(sqlByTag, allowed) {
  const allowance = new Set(allowed);
  return [...sqlByTag]
    .filter(([tag]) => !allowance.has(tag))
    .map(([tag, sql]) => ({ tag, kinds: destructiveKinds(sql) }))
    .filter(({ kinds }) => kinds.length > 0);
}
