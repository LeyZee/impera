// The supervisor of the CRM on the agency's PC (ADR 0125 § 1): the built API (worker inline, as `pnpm dev:crm` ran
// it) and the built site, each restarted after a crash with a growing pause, and stopped cleanly. It listens on
// nothing itself; the API and the site keep their own loopback addresses.

/** The message the API stops on, through the IPC channel (apps/api/src/shutdown.ts): Windows has no SIGTERM to send. */
export const STOP_MESSAGE = 'impera:stop';

/** How long the API gets to drain its worker after the stop message, then it is killed (its own limit is 28 s). */
const STOP_GRACE_MS = 30_000;

/** A child up this long after its start is deemed recovered: its next crash restarts it after the shortest pause. */
const RECOVERED_AFTER_MS = 5 * 60_000;

/** The pause before restarting a child after its `crashes`-th crash in a row: 1 s, doubling, at most one minute. */
export function restartDelay(crashes) {
  return Math.min(1000 * 2 ** Math.max(0, crashes - 1), 60_000);
}

/**
 * Runs `children` (`{ name, command, args, cwd, ipc }`) through the injected `spawn(child)`, which returns
 * `{ onExit(listener), send(message), kill() }`. `log(event, fields)` journals, `now()` and `setTimer(fn, ms)` are
 * the clock (the tests give their own).
 */
export function createSupervisor({ children, spawn, log, now, setTimer }) {
  /** Per child: the running process, its crashes in a row, when it started. */
  const running = new Map();
  let stopping = false;

  const launch = (child) => {
    const entry = running.get(child.name) ?? { process: undefined, crashes: 0, startedAt: 0 };
    entry.startedAt = now();
    entry.process = spawn(child);
    running.set(child.name, entry);
    log('child_start', { name: child.name });
    entry.process.onExit((code) => {
      entry.process = undefined;
      if (stopping) return;
      entry.crashes = now() - entry.startedAt >= RECOVERED_AFTER_MS ? 1 : entry.crashes + 1;
      const delay = restartDelay(entry.crashes);
      log('child_exit', { name: child.name, code: code ?? 'signal', restart_in_s: delay / 1000 });
      setTimer(() => {
        if (!stopping) launch(child);
      }, delay);
    });
  };

  /** Stops one child: the stop message to a child with an IPC channel, then a kill after the grace period. */
  const stopChild = (entry, child) =>
    new Promise((resolve) => {
      const { process } = entry;
      if (process === undefined) {
        resolve();
        return;
      }
      process.onExit(() => resolve());
      if (child.ipc) {
        process.send(STOP_MESSAGE);
        setTimer(() => {
          if (entry.process !== undefined) process.kill();
        }, STOP_GRACE_MS);
      } else {
        process.kill();
      }
    });

  return {
    start: () => {
      stopping = false;
      for (const child of children) launch(child);
    },
    /** Resolves once every child has exited; none is restarted until the next `start`. */
    stop: async () => {
      stopping = true;
      await Promise.all(
        children.map((child) => {
          const entry = running.get(child.name);
          return entry === undefined ? Promise.resolve() : stopChild(entry, child);
        }),
      );
      running.clear();
      log('stopped');
    },
  };
}
