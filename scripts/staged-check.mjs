// Pre-commit format and lint of the staged files (lefthook). A Node script rather than `prettier {staged_files}`:
// lefthook passes the files as arguments, and a merge commit that stages thousands of them goes over the command-line
// limit of Windows (« La ligne de commande est trop longue »). Here the list comes from git through a pipe and goes to
// Prettier and ESLint through their Node APIs: no command line grows with it.
//
// Usage: node scripts/staged-check.mjs format|lint
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** From this many staged files, the check says it may take a while before it starts. */
const LONG_RUN_FILES = 200;

/** The files each check reads, by extension: the globs the hooks had in lefthook.yml. */
export const CHECKS = {
  format: ['ts', 'tsx', 'js', 'mjs', 'json', 'yaml', 'yml', 'css'],
  lint: ['ts', 'tsx'],
};

/**
 * The staged paths a check reads, from the NUL-separated output of `git diff --cached --name-only -z`: added, copied,
 * modified or renamed (what lefthook's `{staged_files}` holds), with one of the check's extensions.
 */
export function stagedFor(check, gitOutput) {
  const extensions = new Set(CHECKS[check]);
  return gitOutput
    .split('\0')
    .filter((path) => path !== '')
    .filter((path) => {
      const dot = path.lastIndexOf('.');
      return dot > path.lastIndexOf('/') && extensions.has(path.slice(dot + 1));
    });
}

async function format(root, files) {
  const prettier = await import('prettier');
  const ignorePath = resolve(root, '.prettierignore');
  const unformatted = [];
  for (const file of files) {
    const path = resolve(root, file);
    const info = await prettier.getFileInfo(path, { ignorePath });
    if (info.ignored || info.inferredParser === null) continue;
    const options = (await prettier.resolveConfig(path)) ?? {};
    const source = await readFile(path, 'utf8');
    if (!(await prettier.check(source, { ...options, filepath: path }))) unformatted.push(file);
  }
  for (const file of unformatted) console.error(`[warn] ${file}`);
  if (unformatted.length > 0) {
    console.error(
      `[warn] Code style issues found in ${String(unformatted.length)} file(s). Run pnpm format.`,
    );
  }
  return unformatted.length === 0;
}

async function lint(root, files) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: root, warnIgnored: false });
  const results = await eslint.lintFiles(files.map((file) => resolve(root, file)));
  const output = await (await eslint.loadFormatter('stylish')).format(results);
  if (output !== '') console.error(output);
  return results.every((result) => result.errorCount === 0 && result.fatalErrorCount === 0);
}

// Run by lefthook (not when imported by its test).
if (process.argv[1]?.endsWith('staged-check.mjs') === true) {
  const check = process.argv[2];
  if (check !== 'format' && check !== 'lint') {
    console.error('Usage: node scripts/staged-check.mjs format|lint');
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = stagedFor(check, staged);
  // A merge can stage thousands of files: say so, rather than stay silent for minutes.
  if (files.length >= LONG_RUN_FILES) {
    console.error(
      `staged-check ${check}: ${String(files.length)} staged files, this can take a few minutes…`,
    );
  }
  if (files.length > 0) {
    const ok = check === 'format' ? await format(root, files) : await lint(root, files);
    if (!ok) process.exit(1);
  }
}
