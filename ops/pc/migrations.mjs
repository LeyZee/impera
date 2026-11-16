// What an update brings to the database (ADR 0125 § 2 and § 4): the migrations it adds, read from Drizzle's journal
// at two commits, and whether one of them could destroy data. Pure: the caller reads the files through git.

/** Where Drizzle keeps its journal and the SQL of each migration, from the repository root. */
export const MIGRATIONS_DIR = 'packages/db/migrations';
export const JOURNAL_PATH = `${MIGRATIONS_DIR}/meta/_journal.json`;

/**
 * Statements that can lose data, refused unless the owner allowed the migration by its name. Deliberately broad: a
 * comment or a string that names one of them refuses the update too, which only costs a start on the present version
 * and an alert, never data. `DELETE` alone would match every `ON DELETE CASCADE`, hence `DELETE FROM`; `ALTER TABLE …
 * DROP <name>` without `COLUMN` is still a column (Postgres allows it), so any `DROP` not followed by a word that
 * removes no rows (constraint, default, not null, …) is refused. `TRUNCATE` counts where a statement starts: the
 * privilege of the same name, revoked by the append-only migrations (`REVOKE … TRUNCATE ON`), empties nothing.
 */
const DESTRUCTIVE = [
  { kind: 'DROP TABLE', pattern: /\bDROP\s+TABLE\b/i },
  { kind: 'DROP COLUMN', pattern: /\bDROP\s+COLUMN\b/i },
  { kind: 'DROP SCHEMA', pattern: /\bDROP\s+SCHEMA\b/i },
  { kind: 'DROP DATABASE', pattern: /\bDROP\s+DATABASE\b/i },
  { kind: 'TRUNCATE', pattern: /(?:^|;)\s*TRUNCATE\b/im },
  { kind: 'DELETE FROM', pattern: /\bDELETE\s+FROM\b/i },
  {
    kind: 'ALTER TABLE DROP',
    pattern:
      /\bALTER\s+TABLE\b[^;]*\bDROP\s+(?!CONSTRAINT\b|DEFAULT\b|NOT\s+NULL\b|IDENTITY\b|EXPRESSION\b|COLUMN\b)("?[A-Za-z_]+"?)/i,
  },
];

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

/** The destructive statements of one migration's SQL, by kind, each once. */
export function destructiveKinds(sql) {
  return DESTRUCTIVE.filter(({ pattern }) => pattern.test(sql)).map(({ kind }) => kind);
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
