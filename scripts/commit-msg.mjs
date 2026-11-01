// Commit-msg guard (lefthook): the first line follows Conventional Commits (docs/conventions/git-and-pr.md).
// A Node script rather than a shell one-liner: lefthook on Windows wraps `run` in `sh -c "…"`, and the double quotes
// of the one-liner broke that quoting on every commit.
import { readFileSync } from 'node:fs';

const CONVENTIONAL =
  /^(Merge |(feat|fix|docs|style|chore|refactor|test|perf|build|ci|revert)(\([a-z0-9-]+\))?!?: .{1,72}$)/;

/** True when the first line of the message is a Conventional Commit, or a merge. */
export function isConventional(message) {
  return CONVENTIONAL.test(message.split(/\r?\n/)[0] ?? '');
}

// Run by lefthook with the message file (not when imported by its test).
if (process.argv[1]?.endsWith('commit-msg.mjs') === true) {
  const file = process.argv[2];
  if (file === undefined || !isConventional(readFileSync(file, 'utf8'))) {
    console.error('Commit message does not follow Conventional Commits (see docs/conventions/git-and-pr.md)');
    process.exit(1);
  }
}
