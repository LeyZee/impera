#!/usr/bin/env node
// `pnpm sessions:log [n | --all]`: the session journal, newest first, read from docs/sessions/log/ (one file per
// session, named <date>-<slug>.md). The folder is the index: no session edits a shared file, so two pull requests
// never conflict on the journal. Newest means the order the entries entered the repository (git), so several entries
// of one day come out in the order they landed; an entry not committed yet comes first. Default: the last 10.
// No dependency: Node 22 and git.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'docs/sessions/log');
const arg = process.argv[2];
const count =
  arg === undefined ? 10 : arg === '--all' ? Infinity : /^[1-9]\d*$/.test(arg) ? Number(arg) : NaN;
if (Number.isNaN(count)) {
  console.error('usage: pnpm sessions:log [n | --all], n a positive whole number');
  process.exit(1);
}

/** When each entry was added, from git: newest commit first, so the first time a file is seen is when it entered. */
const addedAt = new Map();
const log = spawnSync(
  'git',
  ['log', '--diff-filter=A', '--format=%x00%ct', '--name-only', '--', 'docs/sessions/log'],
  { cwd: root, encoding: 'utf8' },
);
let time = 0;
for (const line of (log.status === 0 ? log.stdout : '').split('\n')) {
  if (line.startsWith('\0')) time = Number(line.slice(1));
  else if (line.startsWith('docs/sessions/log/')) {
    const name = line.slice('docs/sessions/log/'.length);
    if (!addedAt.has(name)) addedAt.set(name, time);
  }
}

const files = readdirSync(dir)
  .filter((name) => name.endsWith('.md'))
  .map((name) => ({ name, at: addedAt.get(name) ?? Infinity }))
  .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name))
  .slice(0, count);
for (const { name } of files) {
  const title = readFileSync(join(dir, name), 'utf8').split('\n', 1)[0].replace(/^#\s*/, '');
  console.log(`${title}\n  docs/sessions/log/${name}`);
}
