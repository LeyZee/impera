#!/usr/bin/env node
// Repository consistency checks, part of `pnpm check` (and of the pre-commit hook with --staged).
//  1. Every file path cited in a Markdown file exists. Paths under apps/ and packages/ only warn
//     until the code exists (--strict turns them into errors).
//  2. Every task card docs/sessions/tasks/<ID>-*.md is listed in docs/sessions/tasks/README.md, and vice versa.
//     Same for ADRs and docs/adr/README.md.
//  3. No tracked file above 500 KB (media and exports do not belong in the repository); Drizzle's snapshots excepted.
//  4. No forbidden file names (*.bak, *.orig, *.copy, *-v2.*, *_final*, tmp/, old/): docs/conventions/hygiene.md.
//  5. Every TODO/FIXME in code carries a task card id: `TODO(P2-03): ...` (docs/conventions/coding.md).
//  6. Every `pnpm <script>` cited in the docs exists in the root package.json.
//  7. The nightly CI job still runs `pnpm probe` and `pnpm evals`: removing the quality gate is an error.
//  8. Every root script that delegates with `pnpm --filter <package> [run] <script>` reaches a package of the
//     workspace that has that script, and every `tsx <file>` of a package script names a file that exists.
//  9. The session journal is one file per session: docs/sessions/log/<date>-<slug>.md whose first line starts
//     with `# <date>`, and no row beyond the frozen count of the index of docs/sessions/LOG.md (the shared table made every
//     merge conflict; `pnpm sessions:log` reads the folder instead).
// No dependency: Node 22 only.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const strict = process.argv.includes('--strict');
const stagedOnly = process.argv.includes('--staged');
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.scratch',
  'dist',
  '.output',
  '.turbo',
  'coverage',
  'brainstorm',
]);
const PLANNED_PREFIXES = ['apps/', 'packages/'];
const MAX_BYTES = 500 * 1024;
/** Rows of the frozen index of docs/sessions/LOG.md (check 9): one more is refused, whatever its date. */
const LOG_INDEX_ROWS = 153;
const FORBIDDEN_NAMES = [
  /\.(bak|orig|copy|tmp)$/i,
  /-v\d+\.[a-z]+$/i,
  /_final/i,
  /(^|\/)(tmp|old|backup)\//i,
];
const TODO_WITHOUT_ID = /\b(TODO|FIXME|XXX)\b(?!\((P\d-\d\d|H-\d\d|D-\d\d)\))/;
const PNPM_BUILTINS = new Set([
  'install',
  'add',
  'remove',
  'up',
  'update',
  'dlx',
  'exec',
  'run',
  'audit',
  'why',
  'ls',
  'list',
  'outdated',
  'eslint',
  'prettier',
  'vitest',
  'tsc',
  'knip',
  'drizzle-kit',
  'turbo',
  'playwright',
  'promptfoo',
  'lefthook',
  'x',
  'create',
]);

const errors = [];
const warnings = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = stagedOnly
  ? execSync('git diff --cached --name-only --diff-filter=ACMR', { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((f) => join(root, f))
      .filter((f) => existsSync(f))
  : walk(root);
// Forward slashes on every OS: the checks below compare against POSIX paths (`scripts/check-repo`, `tmp/`).
const rel = (f) => relative(root, f).split(sep).join('/');

// 3. Size, 4. Forbidden names, 5. TODO without id
for (const f of files) {
  const r = rel(f);
  // The compiler's incremental state (`incremental` in tsconfig.base.json) is ignored by git and rewritten by every
  // typecheck, which runs before this script: its size says nothing about the repository. Drizzle's snapshots are
  // generated text, one per migration and the whole schema each, never edited by hand (packages/db/README.md): they grow
  // with the schema, past 500 KB from 0098 on, and are neither media nor an export.
  const generated =
    r.endsWith('.tsbuildinfo') || /^packages\/db\/migrations\/meta\/\d{4}_snapshot\.json$/.test(r);
  if (statSync(f).size > MAX_BYTES && !generated) errors.push(`${r}: larger than 500 KB`);
  if (FORBIDDEN_NAMES.some((re) => re.test(r))) errors.push(`${r}: forbidden file name (hygiene.md)`);
  if (/\.(ts|tsx|mjs|js)$/.test(r) && !r.startsWith('scripts/check-repo')) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (TODO_WITHOUT_ID.test(line))
        errors.push(`${r}:${i + 1}: TODO without a task card id, e.g. TODO(P2-03)`);
    });
  }
}

if (!stagedOnly) {
  const mdFiles = files.filter((f) => f.endsWith('.md'));
  const scripts = Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {});

  // 1. Cited paths, 6. Cited pnpm scripts
  const pathLike =
    /^(?:docs|apps|packages|personas|evals|brand|scripts|\.github|CLAUDE\.md|README\.md|docker-compose\.yml)(?:\/[^\s`)]*)?$/;
  for (const md of mdFiles) {
    const text = readFileSync(md, 'utf8');
    const r = rel(md);
    const candidates = new Set();
    for (const m of text.matchAll(/`([^`\n]+)`/g)) candidates.add(m[1]);
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) candidates.add(m[1]);
    for (let c of candidates) {
      c = c.split('#')[0];
      if (
        !c ||
        c.startsWith('http') ||
        c.includes('*') ||
        c.includes('<') ||
        c.includes('{') ||
        c.includes(' ')
      )
        continue;
      if (!pathLike.test(c)) continue;
      const target = c.endsWith('/') ? c.slice(0, -1) : c;
      if (existsSync(join(root, target))) continue;
      const planned = PLANNED_PREFIXES.some((p) => target.startsWith(p));
      (planned && !strict ? warnings : errors).push(`${r}: path not found \`${c}\``);
    }
    for (const m of text.matchAll(/(?:`|^\s*)pnpm ([a-z][a-z0-9:-]*)/gm)) {
      const name = m[1];
      if (PNPM_BUILTINS.has(name) || scripts.includes(name)) continue;
      errors.push(`${r}: \`pnpm ${name}\` is not a script of the root package.json`);
    }
  }

  // 2. Task cards and ADRs vs their index
  function checkIndex(dir, indexFile, idPattern, label) {
    const indexText = readFileSync(join(root, indexFile), 'utf8');
    const onDisk = readdirSync(join(root, dir))
      .filter((f) => idPattern.test(f))
      .map((f) => f.match(idPattern)[1]);
    const inIndex = [...indexText.matchAll(/^\|\s*([A-Z]+\d*-\d+|\d{4})\s*\|/gm)].map((m) => m[1]);
    for (const id of onDisk)
      if (!inIndex.includes(id))
        errors.push(`${indexFile}: ${label} ${id} exists on disk but is missing from the index`);
    for (const id of inIndex)
      if (!onDisk.includes(id))
        errors.push(`${indexFile}: ${label} ${id} is in the index but no file matches in ${dir}`);
  }
  checkIndex('docs/sessions/tasks', 'docs/sessions/tasks/README.md', /^([A-Z]+\d*-\d+)-.*\.md$/, 'task card');
  checkIndex('docs/adr', 'docs/adr/README.md', /^(\d{4})-.*\.md$/, 'ADR');
}

// 8. Delegated scripts reach something (revue 09, G14)
if (!stagedOnly) {
  const workspace = new Map();
  for (const dir of ['apps', 'packages']) {
    for (const name of readdirSync(join(root, dir))) {
      const manifest = join(root, dir, name, 'package.json');
      if (existsSync(manifest)) workspace.set(join(dir, name), manifest);
    }
  }
  if (existsSync(join(root, 'evals/package.json'))) workspace.set('evals', join(root, 'evals/package.json'));
  const packages = new Map();
  for (const [dir, manifest] of workspace) {
    const { name, scripts = {} } = JSON.parse(readFileSync(manifest, 'utf8'));
    packages.set(name, { dir, scripts });
    for (const [script, command] of Object.entries(scripts)) {
      for (const m of command.matchAll(/\btsx(?: watch)?(?: --[\w-]+(?:=\S+)?)* (\S+\.(?:ts|mts|mjs|js))/g)) {
        if (!existsSync(join(root, dir, m[1])))
          errors.push(`${dir}/package.json: script \`${script}\` runs \`${m[1]}\`, which does not exist`);
      }
    }
  }
  const rootScripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  for (const [script, command] of Object.entries(rootScripts)) {
    for (const m of command.matchAll(/pnpm --filter (\S+) (?:run )?([a-z][\w:-]*)/g)) {
      const target = packages.get(m[1]);
      if (target === undefined)
        errors.push(
          `package.json: script \`${script}\` filters on \`${m[1]}\`, which is not a workspace package`,
        );
      else if (!(m[2] in target.scripts))
        errors.push(
          `package.json: script \`${script}\` calls \`${m[2]}\`, missing from ${target.dir}/package.json`,
        );
    }
  }
}

// 7. The nightly quality gate stays in CI
if (!stagedOnly) {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  // The nightly job only, up to the next job: an active step, alone on its line (no comment, no `|| true`).
  const start = ci.indexOf('\n  nightly:');
  const rest = start === -1 ? '' : ci.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:/);
  const nightly = next === -1 ? rest : rest.slice(0, next + 1);
  for (const command of ['pnpm probe', 'pnpm evals']) {
    if (!new RegExp(`^ +- run: ${command}[ \\t]*$`, 'm').test(nightly))
      errors.push(
        `.github/workflows/ci.yml: the nightly job must run \`${command}\` (docs/playbooks/write-an-eval.md)`,
      );
  }
  if (/^\s*continue-on-error:\s*true/m.test(nightly))
    errors.push(
      '.github/workflows/ci.yml: the nightly job must fail when the evals fail (no continue-on-error)',
    );
}

// 9. The session journal: one file per session, and the index of LOG.md stays frozen
if (!stagedOnly) {
  const logDir = join(root, 'docs/sessions/log');
  for (const name of readdirSync(logDir)) {
    const match = /^(\d{4}-\d{2}-\d{2})-[a-z0-9-]+\.md$/.exec(name);
    if (match === null) {
      errors.push(`docs/sessions/log/${name}: name it <AAAA-MM-JJ>-<slug>.md (docs/sessions/README.md)`);
      continue;
    }
    const first = readFileSync(join(logDir, name), 'utf8').split('\n', 1)[0];
    if (!first.startsWith(`# ${match[1]}`))
      errors.push(`docs/sessions/log/${name}: the first line must start with \`# ${match[1]}\``);
  }
  const index = readFileSync(join(root, 'docs/sessions/LOG.md'), 'utf8');
  const rows = [...index.matchAll(/^\|.*`log\/\d{4}-\d{2}-\d{2}-[^`]*`/gm)].length;
  if (rows > LOG_INDEX_ROWS)
    errors.push(
      `docs/sessions/LOG.md: the index is frozen at ${String(LOG_INDEX_ROWS)} rows (${String(rows)} now); a session writes its own file in docs/sessions/log/ and adds no row`,
    );
}

for (const w of warnings) console.warn(`warning: ${w}`);
for (const e of errors) console.error(`error: ${e}`);
console.log(
  `check-repo: ${errors.length} error(s), ${warnings.length} warning(s)${stagedOnly ? ' (staged files only)' : ''}`,
);
process.exit(errors.length > 0 ? 1 : 0);
