// The program's own files on the PC, all under ops/pc/local/ (ignored by git): the owner's settings (config.json),
// what the program remembers between starts (state.json), what the CRM shows (status.json) and the journal
// (journal.log). Hand-validated: the repository root has no Zod, and this program needs nothing installed to read
// its settings.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCAL_DIR = 'ops/pc/local';

const BACKUP_TIMEOUT_MINUTES = 30;

const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * The owner's settings, from the text of config.json (`undefined` when the file is absent). Throws with the field at
 * fault, in French, on anything else than the documented shape (README): an unknown field is refused too, so that a
 * typo never silently turns the backup off.
 */
export function parseConfig(text) {
  if (text === undefined) return { backup: undefined, allowDestructiveMigrations: [] };
  const raw = JSON.parse(text);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('config.json : un objet attendu');
  for (const key of Object.keys(raw)) {
    if (key !== 'backup' && key !== 'allowDestructiveMigrations') {
      throw new Error(`config.json : champ inconnu « ${key} »`);
    }
  }
  const allowed = raw.allowDestructiveMigrations ?? [];
  if (!isStringArray(allowed)) {
    throw new Error('config.json : allowDestructiveMigrations doit être une liste de noms de migrations');
  }
  if (raw.backup === undefined) return { backup: undefined, allowDestructiveMigrations: allowed };
  const { backup } = raw;
  if (backup === null || typeof backup !== 'object' || Array.isArray(backup)) {
    throw new Error('config.json : backup doit être un objet');
  }
  for (const key of Object.keys(backup)) {
    if (key !== 'command' && key !== 'args' && key !== 'timeoutMinutes') {
      throw new Error(`config.json : champ inconnu « backup.${key} »`);
    }
  }
  if (typeof backup.command !== 'string' || backup.command.trim() === '') {
    throw new Error('config.json : backup.command doit nommer le programme à lancer');
  }
  const args = backup.args ?? [];
  if (!isStringArray(args)) throw new Error('config.json : backup.args doit être une liste de textes');
  const timeoutMinutes = backup.timeoutMinutes ?? BACKUP_TIMEOUT_MINUTES;
  if (!Number.isInteger(timeoutMinutes) || timeoutMinutes < 1 || timeoutMinutes > 240) {
    throw new Error('config.json : backup.timeoutMinutes doit être un entier de 1 à 240');
  }
  return {
    backup: { command: backup.command, args, timeoutMinutes },
    allowDestructiveMigrations: allowed,
  };
}

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * What the program remembers between starts: the commit last built, the one whose migrations the base last received,
 * the one whose start failed (not retried until `main` moves past it), and when the last update succeeded. Anything unreadable is forgotten: the next
 * start rebuilds, which costs minutes, never data.
 */
export function parseState(text) {
  const empty = {
    builtCommit: undefined,
    migratedCommit: undefined,
    failedCommit: undefined,
    updatedAt: undefined,
  };
  if (text === undefined) return empty;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return empty;
  }
  if (raw === null || typeof raw !== 'object') return empty;
  const commit = (value) => (typeof value === 'string' && COMMIT.test(value) ? value : undefined);
  return {
    builtCommit: commit(raw.builtCommit),
    migratedCommit: commit(raw.migratedCommit),
    failedCommit: commit(raw.failedCommit),
    updatedAt:
      typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : undefined,
  };
}

/** Reads and writes the local files under the repository root given. */
export function localFiles(root) {
  const dir = join(root, LOCAL_DIR);
  const read = (name) => {
    const path = join(dir, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
  };
  // Written beside, then renamed: a PC switched off mid-write never leaves half a file.
  const write = (name, value) => {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    writeFileSync(`${path}.next`, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(`${path}.next`, path);
  };
  return {
    readConfig: () => parseConfig(read('config.json')),
    readState: () => parseState(read('state.json')),
    writeState: (state) => write('state.json', state),
    writeStatus: (status) => write('status.json', status),
    appendJournal: (line) => {
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, 'journal.log'), `${line}\n`);
    },
  };
}
