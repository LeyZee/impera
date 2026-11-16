// « Démarrer Impera » (ADR 0125 § 2 and § 4): update the code, then start the CRM and check its health, or go back to
// the previous version. Everything outside is injected (git, pnpm, the backup, the CRM's processes, the local files):
// the tests drive it with fakes, `start.mjs` with the real ones.
import {
  JOURNAL_PATH,
  MIGRATIONS_DIR,
  journalTags,
  migrationDiff,
  refusedMigrations,
} from './migrations.mjs';

/** ADR 0125 § 2: the CRM answers within two minutes of its start, or the version is deemed broken. */
const HEALTH_TIMEOUT_MS = 2 * 60_000;

const short = (commit) => (commit === undefined ? 'none' : commit.slice(0, 7));

/**
 * What to do with the code at this start, from what the repository says (pure). `fetched` is undefined when the
 * fetch was not tried (dirty tree, other branch), false without network. Only a fast-forward of `main` is an
 * update; anything else starts the present version, with an amber alert when the owner should look.
 */
export function decideUpdate({ clean, branch, fetched, head, upstream, headInUpstream, failedCommit }) {
  if (!clean) return { action: 'current', reason: 'dirty', tone: 'amber' };
  if (branch !== 'main') return { action: 'current', reason: 'not_main', tone: 'amber' };
  if (fetched !== true) return { action: 'current', reason: 'offline', tone: 'neutral' };
  if (upstream === head) return { action: 'current', reason: 'up_to_date', tone: 'neutral' };
  if (upstream === failedCommit) return { action: 'current', reason: 'known_failed', tone: 'amber' };
  if (headInUpstream !== true) return { action: 'current', reason: 'diverged', tone: 'amber' };
  return { action: 'update', from: head, to: upstream };
}

/**
 * After the new version's health check (pure): keep it, go back to the previous commit, or stop. The previous
 * version gets one try; if it fails too, the CRM stays stopped with a red alert (ADR 0125 § 4).
 */
export function decideAfterHealth({ healthy, isRollback }) {
  if (healthy) return isRollback ? 'rolled_back' : 'keep';
  return isRollback ? 'stop' : 'rollback';
}

const DATE = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  dateStyle: 'long',
  timeStyle: 'short',
});

/** The words the owner reads, in the CRM (once it shows the line) and in the start window. */
const REASON_TEXT = {
  dirty: 'Mise à jour en attente : le dépôt a des changements faits à la main.',
  not_main: 'Mise à jour en attente : le dépôt n’est pas sur main.',
  diverged: 'Mise à jour en attente : le dépôt a des commits que main n’a pas.',
  offline: 'Pas de réseau : version présente démarrée.',
  destructive: 'Mise à jour en attente : une migration pourrait effacer des données, elle attend ta demande.',
  no_backup:
    'Mise à jour en attente : sauvegarde non réglée (ops/pc/local/config.json), migrations non lancées.',
  unreadable_journal: 'Mise à jour en attente : journal des migrations illisible.',
  rewritten_journal: 'Mise à jour en attente : l’historique des migrations a changé.',
  merge_failed: 'Mise à jour en attente : la récupération de main a échoué.',
};

/** The status file the CRM reads (contract in docs/sessions/tasks/OPS-17-pc-start-update.md). */
export function statusFor({ outcome, reason, tone, commit, updatedAt, now }) {
  let line;
  if (outcome === 'stopped') line = 'CRM arrêté : la mise à jour et la version précédente ont échoué.';
  else if (outcome === 'rolled_back' || reason === 'known_failed')
    line = 'Mise à jour échouée, version précédente';
  else if (updatedAt === undefined) line = 'Version présente';
  else line = `Mis à jour le ${DATE.format(new Date(updatedAt))}`;
  return {
    version: 1,
    outcome,
    reason,
    tone,
    line,
    detail: REASON_TEXT[reason] ?? null,
    commit: commit === undefined ? null : short(commit),
    updatedAt: updatedAt ?? null,
    at: now.toISOString(),
  };
}

/**
 * One start. Returns `{ running, status }`: `running` when the CRM answered its health check and the supervisor keeps
 * it up. `deps`:
 * - `git`: `isClean()`, `branch()`, `head()`, `fetch()` (false without network), `upstream()`, `isAncestor(a, b)`,
 *   `show(commit, path)` (undefined when absent), `fastForward(commit)`, `resetTo(commit)`;
 * - `install()`, `build()`, `stage()`, `backup(settings)`, `migrate()`: each resolves to true on success;
 * - `crm`: `start()`, `healthy(timeoutMs)`, `stop()`;
 * - `config`, `readState()`, `writeState(state)`, `writeStatus(status)`, `journal(line)`, `now()`.
 * Ctrl+C ends the program itself (start.mjs): the state is then not written, and the next start redoes the build
 * and the migrations of the commit present, since its build is not of record.
 */
export async function startImpera(deps) {
  const { git, crm } = deps;
  const state = { ...deps.readState() };
  const log = (event, fields = {}) =>
    deps.journal(
      [
        deps.now().toISOString(),
        event,
        ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
      ].join(' '),
    );

  /** Runs one step, journals its duration and outcome. */
  const step = async (name, run) => {
    const started = deps.now().getTime();
    const ok = await run();
    log('step', {
      name,
      status: ok ? 'ok' : 'failed',
      seconds: Math.round((deps.now().getTime() - started) / 1000),
    });
    return ok;
  };

  const finish = (outcome, { reason, tone, commit, running }) => {
    deps.writeState(state);
    const status = statusFor({ outcome, reason, tone, commit, updatedAt: state.updatedAt, now: deps.now() });
    deps.writeStatus(status);
    log('finish', { outcome, reason, commit: short(commit) });
    return { running, status };
  };

  /** Install, build and lay out the built API; the build of record is forgotten until it succeeds. */
  const prepare = async () => {
    state.builtCommit = undefined;
    return (
      (await step('install', deps.install)) &&
      (await step('build', deps.build)) &&
      (await step('stage', deps.stage))
    );
  };
  /** Starts the CRM and waits for its health; on failure stops what was started. */
  const startAndCheck = async () => {
    await crm.start();
    const healthy = await step('health', () => crm.healthy(HEALTH_TIMEOUT_MS));
    if (!healthy) await crm.stop();
    return healthy;
  };

  /** Reads the migrations `to` adds to the base, and whether this start may apply them. */
  const pendingMigrations = async (from, to) => {
    const [oldText, newText] = await Promise.all([git.show(from, JOURNAL_PATH), git.show(to, JOURNAL_PATH)]);
    let diff;
    try {
      if (newText === undefined) throw new Error('journal absent');
      diff = migrationDiff(oldText === undefined ? [] : journalTags(oldText), journalTags(newText));
    } catch {
      return { refusal: 'unreadable_journal' };
    }
    if (diff.rewritten) return { refusal: 'rewritten_journal' };
    const sql = new Map();
    for (const tag of diff.added) {
      const text = await git.show(to, `${MIGRATIONS_DIR}/${tag}.sql`);
      if (text === undefined) return { refusal: 'unreadable_journal' };
      sql.set(tag, text);
    }
    const refused = refusedMigrations(sql, deps.config.allowDestructiveMigrations);
    for (const { tag, kinds } of refused)
      log('refused_migration', { tag, kinds: kinds.join(',').replaceAll(' ', '_') });
    if (refused.length > 0) return { refusal: 'destructive' };
    if (diff.added.length > 0 && deps.config.backup === undefined) return { refusal: 'no_backup' };
    for (const tag of diff.added) log('migration', { tag });
    return { added: diff.added };
  };

  /** Backup first, then the migrations (ADR 0125 § 2); `to` is the commit whose migrations the base now has. */
  const applyMigrations = async (added, to) => {
    if (added.length > 0) {
      if (!(await step('backup', () => deps.backup(deps.config.backup)))) return 'backup_failed';
      if (!(await step('migrate', deps.migrate))) return 'migrate_failed';
    }
    state.migratedCommit = to;
    return 'ok';
  };

  /** Back to `previous` (ADR 0125 § 4): its code, rebuilt, restarted; the migrations stay where they are. */
  const rollback = async (previous, reason) => {
    log('rollback', { to: short(previous), reason });
    const restored =
      (await step('reset', () => git.resetTo(previous))) && (await prepare()) && (await startAndCheck());
    if (restored) state.builtCommit = previous;
    const after = decideAfterHealth({ healthy: restored, isRollback: true });
    return after === 'rolled_back'
      ? finish('rolled_back', { reason, tone: 'amber', commit: previous, running: true })
      : finish('stopped', { reason, tone: 'red', commit: previous, running: false });
  };

  /** Starts the version present, building it first when the last build was of another commit. */
  const startCurrent = async (head, reason, tone, clean) => {
    if (clean && state.builtCommit !== head) {
      const pending = await pendingMigrations(state.migratedCommit ?? head, head);
      if (pending.refusal !== undefined) {
        return finish('stopped', { reason: pending.refusal, tone: 'red', commit: head, running: false });
      }
      const built = await prepare();
      const migrated = built ? await applyMigrations(pending.added, head) : 'build_failed';
      if (migrated !== 'ok')
        return finish('stopped', { reason: migrated, tone: 'red', commit: head, running: false });
      state.builtCommit = head;
    }
    if (state.migratedCommit === undefined && clean) state.migratedCommit = head;
    if (!(await startAndCheck()))
      return finish('stopped', { reason: 'unhealthy', tone: 'red', commit: head, running: false });
    return finish(reason === 'up_to_date' || reason === 'offline' ? 'up_to_date' : 'current', {
      reason,
      tone,
      commit: head,
      running: true,
    });
  };

  const head = await git.head();
  log('start', { head: short(head), built: short(state.builtCommit) });
  const clean = await git.isClean();
  const branch = clean ? await git.branch() : undefined;
  const fetched = clean && branch === 'main' ? await step('fetch', git.fetch) : undefined;
  const upstream = fetched === true ? await git.upstream() : undefined;
  const headInUpstream = upstream === undefined ? undefined : await git.isAncestor(head, upstream);
  const decision = decideUpdate({
    clean,
    branch,
    fetched,
    head,
    upstream,
    headInUpstream,
    failedCommit: state.failedCommit,
  });
  log('decision', {
    action: decision.action,
    reason: decision.reason ?? 'new_commits',
    upstream: short(upstream),
  });
  if (decision.action === 'current') return await startCurrent(head, decision.reason, decision.tone, clean);

  const { from, to } = decision;
  const pending = await pendingMigrations(state.migratedCommit ?? from, to);
  if (pending.refusal !== undefined) return await startCurrent(from, pending.refusal, 'amber', clean);
  if (!(await step('fast_forward', () => git.fastForward(to)))) {
    return await startCurrent(from, 'merge_failed', 'amber', clean);
  }
  if (!(await prepare())) {
    state.failedCommit = to;
    return await rollback(from, 'build_failed');
  }
  const migrated = await applyMigrations(pending.added, to);
  if (migrated !== 'ok') {
    // A backup that failed says nothing of the new version: the next start tries again.
    if (migrated === 'migrate_failed') state.failedCommit = to;
    return await rollback(from, migrated);
  }
  const healthy = await startAndCheck();
  if (decideAfterHealth({ healthy, isRollback: false }) === 'rollback') {
    state.failedCommit = to;
    return await rollback(from, 'unhealthy');
  }
  state.builtCommit = to;
  state.failedCommit = undefined;
  state.updatedAt = deps.now().toISOString();
  return finish('updated', { reason: 'updated', tone: 'neutral', commit: to, running: true });
}
