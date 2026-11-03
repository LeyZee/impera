// Secret scan of the git hooks (lefthook), before a commit and before a push. A Node script rather than a bare
// `gitleaks …` line: when the binary is missing, the hook stops with the way to install it instead of a shell's
// « command not found », and the push scan reads exactly the commits no remote branch holds yet.
//
// Usage: node scripts/gitleaks-hook.mjs staged|push
import { spawnSync } from 'node:child_process';

/** The gitleaks arguments of each hook. `--redact` keeps a secret it finds out of the terminal and its logs. */
export const SCANS = {
  // The staged changes: what this commit adds.
  staged: ['git', '--pre-commit', '--staged', '--redact', '--verbose'],
  // Every commit of a local branch that no branch of origin holds: what a push may send, whichever branch it names,
  // including commits made where the pre-commit scan did not run.
  push: ['git', '--log-opts=--branches --not --remotes=origin', '--redact', '--verbose'],
};

/** What the hook says when gitleaks is not on the PATH. Never a bypass: the commit or push waits for the binary. */
export const MISSING =
  'gitleaks est introuvable sur le PATH : le scan de secrets ne peut pas tourner, le commit ou le push est arrêté.\n' +
  'Installe-le (Windows : winget install Gitleaks.Gitleaks ; macOS : brew install gitleaks ; Linux : le binaire de\n' +
  'https://github.com/gitleaks/gitleaks/releases), rouvre le terminal, puis recommence. Jamais --no-verify.';

/** `gitleaks git` came with 8.19: an older binary answers with its usage, which says nothing of what to do. */
export const MIN_VERSION = [8, 19, 0];

/** What the hook says when the binary is older than MIN_VERSION, or its version unreadable. */
export const TOO_OLD = (found) =>
  `gitleaks ${found ?? '(version illisible)'} est trop ancien : le scan de secrets demande la 8.19 ou plus (la CI\n` +
  'utilise la 8.24.2). Le commit ou le push est arrêté. Mets-le à jour (Windows : winget upgrade Gitleaks.Gitleaks ;\n' +
  'macOS : brew upgrade gitleaks ; Linux : le binaire de https://github.com/gitleaks/gitleaks/releases), vérifie que\n' +
  '`gitleaks version` donne la nouvelle (un ancien binaire peut passer avant sur le PATH), puis recommence.';

/** What the push hook adds when the scan finds something: which commits it read, and what to do with them. */
export const PUSH_FOUND =
  "Le push relit les commits de toutes les branches locales qu'aucune branche d'origin ne porte, pas seulement la\n" +
  'branche poussée. `git log --branches --not --remotes=origin --oneline` les liste. Si le secret est dans une\n' +
  'vieille branche qui ne doit pas partir, archive-la hors des branches (git update-ref refs/archive/<nom> <branche>\n' +
  "puis git branch -D <branche>) ; sinon retire le secret de l'historique. Jamais --no-verify.";

/** The version `gitleaks version` printed (`8.24.2`, `v8.24.2`), or null when there is none. */
export function versionOf(output) {
  const found = /v?(\d+)\.(\d+)\.(\d+)/.exec(output);
  return found === null ? null : [Number(found[1]), Number(found[2]), Number(found[3])];
}

/** Whether a version reaches MIN_VERSION. */
export function recentEnough(version) {
  for (let index = 0; index < MIN_VERSION.length; index += 1) {
    if (version[index] !== MIN_VERSION[index]) return version[index] > MIN_VERSION[index];
  }
  return true;
}

/** The scan a hook asks for, or null for an unknown one. */
export function scanFor(mode) {
  return Object.hasOwn(SCANS, mode) ? SCANS[mode] : null;
}

// Run by lefthook (not when imported by its test).
if (process.argv[1]?.endsWith('gitleaks-hook.mjs') === true) {
  const mode = process.argv[2] ?? '';
  const args = scanFor(mode);
  if (args === null) {
    console.error(`Usage : node scripts/gitleaks-hook.mjs staged|push (reçu « ${mode} »).`);
    process.exit(2);
  }
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (probe.error !== undefined) {
    console.error(
      probe.error.code === 'ENOENT' ? MISSING : `gitleaks n'a pas pu démarrer : ${probe.error.message}`,
    );
    process.exit(1);
  }
  const version = versionOf(`${probe.stdout ?? ''}${probe.stderr ?? ''}`);
  if (version === null || !recentEnough(version)) {
    console.error(TOO_OLD(version?.join('.') ?? null));
    process.exit(1);
  }
  const run = spawnSync('gitleaks', args, { stdio: 'inherit' });
  if (run.error !== undefined) {
    console.error(`gitleaks n'a pas pu démarrer : ${run.error.message}`);
    process.exit(1);
  }
  // gitleaks exits 1 when it finds a leak.
  if (mode === 'push' && run.status === 1) console.error(PUSH_FOUND);
  process.exit(run.status ?? 1);
}
