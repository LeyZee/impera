// « Démarrer Impera » (ADR 0125): the one entry of the CRM on the agency's PC, launched by the shortcut and by the
// scheduled task at the owner's logon (ops/pc/README.md). Updates, starts, then keeps the CRM up until Ctrl+C.
// Run: node ops/pc/start.mjs (from anywhere: it finds the repository from its own place).
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LOCAL_DIR, localFiles } from './local-files.mjs';
import {
  backupWith,
  crmAlreadyUp,
  crmChildren,
  ensurePostgres,
  gitOf,
  healthy,
  pnpmOf,
  spawnChild,
  stage,
} from './processes.mjs';
import { createSupervisor } from './supervisor.mjs';
import { startImpera, statusFor } from './update.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const files = localFiles(root);
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const say = (text) => console.log(`\n[Impera] ${text}\n`);
const journal = (line) => {
  files.appendJournal(line);
  console.log(`[Impera] ${line}`);
};

/** One window at a time: the shortcut double-clicked while the task already started the CRM stops here. */
const lockPath = join(root, LOCAL_DIR, 'running.lock');
function takeLock() {
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, 'utf8'));
    try {
      if (Number.isInteger(pid) && pid > 0) {
        process.kill(pid, 0);
        return false;
      }
    } catch {
      // That process is gone: a window closed without its cleanup. The lock is stale.
    }
    rmSync(lockPath, { force: true });
  }
  mkdirSync(dirname(lockPath), { recursive: true });
  const fd = openSync(lockPath, 'wx');
  writeSync(fd, String(process.pid));
  closeSync(fd);
  return true;
}

if (!takeLock()) {
  say('Impera tourne déjà dans une autre fenêtre.');
  process.exit(0);
}
const releaseLock = () => rmSync(lockPath, { force: true });

let interrupted = false;
let supervisor;
const stopAll = async () => {
  if (interrupted) return;
  interrupted = true;
  say('Arrêt du CRM : le worker finit ses tâches en cours…');
  await supervisor?.stop();
  releaseLock();
  process.exit(0);
};
// Ctrl+C (SIGINT), Ctrl+Pause (SIGBREAK), closing the window (SIGHUP, a few seconds before Windows ends it).
for (const signal of ['SIGINT', 'SIGBREAK', 'SIGHUP']) process.on(signal, () => void stopAll());

if (await crmAlreadyUp()) {
  say('Un CRM répond déjà sur le port 3000 (pnpm dev:crm dans un autre terminal ?). Ferme-le, puis relance.');
  releaseLock();
  process.exit(1);
}

let config;
try {
  config = files.readConfig();
} catch (error) {
  say(
    `${error instanceof Error ? error.message : 'config.json illisible'} : aucune migration ne sera lancée.`,
  );
  config = { backup: undefined, allowDestructiveMigrations: [] };
}

say('Démarrage de la base de données…');
if (!(await ensurePostgres(root, wait))) {
  const status = statusFor({
    outcome: 'stopped',
    reason: 'database_unavailable',
    tone: 'red',
    commit: undefined,
    updatedAt: files.readState().updatedAt,
    now: new Date(),
  });
  files.writeStatus(status);
  journal(`${status.at} finish outcome=stopped reason=database_unavailable`);
  say('La base ne démarre pas : Docker Desktop est-il lancé ? Relance « Démarrer Impera » ensuite.');
  releaseLock();
  process.exit(1);
}

supervisor = createSupervisor({
  children: crmChildren(root),
  spawn: spawnChild,
  log: (event, fields = {}) =>
    journal(
      [
        new Date().toISOString(),
        event,
        ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
      ].join(' '),
    ),
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
});

const tools = pnpmOf(root);
const { running, status } = await startImpera({
  git: gitOf(root),
  install: tools.install,
  build: tools.build,
  stage: () => Promise.resolve(stage(root)),
  backup: backupWith(root),
  migrate: tools.migrate,
  crm: { start: supervisor.start, stop: supervisor.stop, healthy: (ms) => healthy(ms, wait) },
  config,
  readState: files.readState,
  writeState: files.writeState,
  writeStatus: files.writeStatus,
  journal,
  now: () => new Date(),
});

if (status !== undefined)
  say([status.line, status.detail].filter((text) => text !== null).join('\n[Impera] '));
if (!running) {
  if (!interrupted) say('Le CRM est arrêté. Le détail est dans ops/pc/local/journal.log.');
  releaseLock();
  process.exit(1);
}
say('CRM prêt : http://localhost:5173. Ctrl+C dans cette fenêtre pour l’arrêter proprement.');
