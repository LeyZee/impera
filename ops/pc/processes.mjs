// The real outside world of « Démarrer Impera »: git, pnpm, docker, the owner's backup command, the CRM's two
// processes and its health. No shell: every command is a program and its arguments, none built from text read
// elsewhere, except `pnpm` on Windows, a `.cmd` that only `cmd.exe` runs (its arguments here are constants).
import { spawn } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

/** The CRM's addresses, as `pnpm dev:crm` had them: the API's PORT in .env and the site's port in its Vite config. */
const API_READY_URL = 'http://localhost:3000/ready';
const API_HEALTH_URL = 'http://localhost:3000/health';
const WEB_URL = 'http://localhost:5173/';

/**
 * Runs a program; resolves to its exit code (null when killed) and, with `capture`, its standard output. Its output
 * is shown in the start window otherwise. `timeoutMs` kills it past that time.
 */
function run(command, args, { cwd, capture = false, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
    });
    const chunks = [];
    child.stdout?.on('data', (chunk) => chunks.push(chunk));
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => child.kill(), timeoutMs);
    const done = (code) => {
      if (timer !== undefined) clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8') });
    };
    child.on('error', () => done(null));
    child.on('close', (code) => done(code));
  });
}

const pnpm = (root, args) =>
  IS_WINDOWS
    ? run('cmd.exe', ['/d', '/c', 'pnpm', ...args], { cwd: root })
    : run('pnpm', args, { cwd: root });

const ok = async (pending) => (await pending).code === 0;

/** The repository's git, as ADR 0125 § 2 uses it: `main` from `origin`, fast-forward only. */
export function gitOf(root) {
  const git = (args, options = {}) => run('git', args, { cwd: root, ...options });
  const text = async (args) => {
    const result = await git(args, { capture: true });
    return result.code === 0 ? result.stdout.trim() : undefined;
  };
  return {
    isClean: async () => (await text(['status', '--porcelain'])) === '',
    branch: () => text(['rev-parse', '--abbrev-ref', 'HEAD']),
    head: async () => {
      const head = await text(['rev-parse', 'HEAD']);
      if (head === undefined) throw new Error('git rev-parse HEAD a échoué');
      return head;
    },
    fetch: () => ok(git(['fetch', '--quiet', 'origin', 'main'], { timeoutMs: 120_000 })),
    upstream: () => text(['rev-parse', 'origin/main']),
    isAncestor: (ancestor, descendant) => ok(git(['merge-base', '--is-ancestor', ancestor, descendant])),
    show: async (commit, path) => {
      const result = await git(['show', `${commit}:${path}`], { capture: true });
      return result.code === 0 ? result.stdout : undefined;
    },
    fastForward: (commit) => ok(git(['merge', '--ff-only', '--quiet', commit])),
    // `--keep` refuses to touch a file changed by hand: the tree is clean here, nothing of the owner's is lost.
    resetTo: (commit) => ok(git(['reset', '--keep', commit])),
  };
}

/** Install, build, migrations: the repository's own commands. */
export function pnpmOf(root) {
  return {
    install: () => ok(pnpm(root, ['install', '--frozen-lockfile'])),
    build: () => ok(pnpm(root, ['build'])),
    migrate: () => ok(pnpm(root, ['db:migrate'])),
  };
}

/**
 * The built API reads its migrations and prompts beside `dist/` (`../migrations`, `../prompts`), as the image lays
 * them out (apps/api/Dockerfile): copied there after each build, both folders ignored by git.
 */
export function stage(root) {
  for (const [from, to] of [
    ['packages/db/migrations', 'apps/api/migrations'],
    ['packages/llm/prompts', 'apps/api/prompts'],
  ]) {
    rmSync(join(root, to), { recursive: true, force: true });
    cpSync(join(root, from), join(root, to), { recursive: true });
  }
  return true;
}

/** The owner's backup command (ops/pc/local/config.json): a success is its exit code 0, within its time. */
export const backupWith = (root) => async (settings) =>
  ok(run(settings.command, settings.args, { cwd: root, timeoutMs: settings.timeoutMinutes * 60_000 }));

/**
 * The development base up and healthy (ADR 0125 § 7 allows this program alone to do it). Docker Desktop may still be
 * starting at logon: tried every 10 s for 3 minutes.
 */
export async function ensurePostgres(root, wait) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    if (
      await ok(
        run('docker', ['compose', 'up', '-d', '--wait', 'postgres'], { cwd: root, timeoutMs: 120_000 }),
      )
    ) {
      return true;
    }
    await wait(10_000);
  }
  return false;
}

const answers = async (url) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return response.ok;
  } catch {
    return false;
  }
};

/** Something already answers on the API's port: a CRM started by hand (`pnpm dev:crm`) or by another window. */
export const crmAlreadyUp = () => answers(API_HEALTH_URL);

/** Healthy: the API ready (base, migrations, worker heartbeat: `/ready`) and the site served, within `timeoutMs`. */
export async function healthy(timeoutMs, wait) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await answers(API_READY_URL)) && (await answers(WEB_URL))) return true;
    await wait(3000);
  }
  return false;
}

/**
 * The CRM's two processes. The API runs its built entry with the root .env, worker inline as `.env` says
 * (IMPERA_INLINE_WORKER). The site is `vite preview` of the built files: in `development` mode its config keeps the
 * `/v1` proxy to the API (apps/web/.env.development), so the session cookie stays on the site's origin as before; the
 * port is the one AUTH_BASE_URL and WEB_ORIGIN name.
 */
export function crmChildren(root) {
  return [
    {
      name: 'api',
      command: process.execPath,
      args: ['--env-file-if-exists=../../.env', 'dist/index.js'],
      cwd: join(root, 'apps/api'),
      ipc: true,
    },
    {
      name: 'web',
      command: process.execPath,
      args: [
        'node_modules/vite/bin/vite.js',
        'preview',
        '--mode',
        'development',
        '--port',
        '5173',
        '--strictPort',
      ],
      cwd: join(root, 'apps/web'),
      ipc: false,
    },
  ];
}

/** Starts one child for the supervisor, its output in the start window. */
export function spawnChild(child) {
  const process = spawn(child.command, child.args, {
    cwd: child.cwd,
    stdio: child.ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
  });
  // A program that could not start ('error') ends like one that stopped: the supervisor restarts it after a pause.
  const exited = new Promise((resolve) => {
    process.once('exit', (code) => resolve(code));
    process.once('error', () => resolve(null));
  });
  return {
    onExit: (listener) => {
      void exited.then(listener);
    },
    send: (message) => {
      if (process.connected) process.send(message);
    },
    kill: () => process.kill(),
  };
}
