// Pre-push guard (lefthook): refuses to push to `main` or delete it. `main` changes only through a green, merged
// pull request. A local guard: GitHub does not enforce it (no branch protection on the free plan), and
// `IMPERA_ALLOW_MAIN_PUSH=1` lets an emergency push through (docs/conventions/git-and-pr.md).
import { readFileSync } from 'node:fs';

const PROTECTED = 'refs/heads/main';

/**
 * Git hands the pre-push hook one line per ref: `<local ref> <local sha> <remote ref> <remote sha>`.
 * Returns the refusals, empty when the push may go.
 */
export function refusals(stdin) {
  return stdin
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4 && fields[2] === PROTECTED)
    .map(([localRef]) =>
      localRef === '(delete)'
        ? 'Suppression de main refusée.'
        : 'Push direct sur main refusé : passe par une PR (main ne change que par une PR verte fusionnée).',
    );
}

// Run by lefthook (not when imported by its test).
if (process.argv[1]?.endsWith('protect-main.mjs') === true) {
  const found = refusals(readFileSync(0, 'utf8'));
  if (found.length > 0 && process.env.IMPERA_ALLOW_MAIN_PUSH !== '1') {
    for (const message of found) console.error(message);
    console.error(
      'Urgence seulement : IMPERA_ALLOW_MAIN_PUSH=1 git push … (voir docs/conventions/git-and-pr.md).',
    );
    process.exit(1);
  }
}
