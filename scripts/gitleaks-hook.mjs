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
  const run = spawnSync('gitleaks', args, { stdio: 'inherit' });
  if (run.error !== undefined) {
    console.error(
      run.error.code === 'ENOENT' ? MISSING : `gitleaks n'a pas pu démarrer : ${run.error.message}`,
    );
    process.exit(1);
  }
  process.exit(run.status ?? 1);
}
