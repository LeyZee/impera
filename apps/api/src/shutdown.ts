import type { Logger } from './logger';

/** Hard stop if the graceful one hangs: under Docker's 30 s before `SIGKILL` (operations.md). */
const FORCED_EXIT_MS = 28_000;

/** How an entry point stops once what it started is up: given once, in the order things must stop. */
export interface GracefulExit {
  readonly stopWith: (stop: () => Promise<void>) => void;
}

/** What the stop needs of the process; the tests give their own. */
export interface ProcessSignals {
  readonly once: (signal: 'SIGTERM' | 'SIGINT', listener: (signal: NodeJS.Signals) => void) => unknown;
  readonly exit: (code: number) => void;
  /** Calls `listener` when the parent asks for the stop over the IPC channel, if the process has one. */
  readonly onStopMessage: (listener: () => void) => unknown;
  /** Calls `listener` when the parent's IPC channel closes (the supervisor died without asking), if there is one. */
  readonly onParentGone: (listener: () => void) => unknown;
}

/**
 * What the supervisor of the agency's PC sends to stop the API (ADR 0125 § 1, ops/pc/supervisor.mjs): on Windows a
 * parent cannot send SIGTERM, Node kills the child outright, so it asks over the IPC channel instead.
 */
const STOP_MESSAGE = 'impera:stop';

const NODE_PROCESS: ProcessSignals = {
  once: (signal, listener) => process.once(signal, listener),
  exit: (code) => process.exit(code),
  onStopMessage: (listener) => {
    // Without a parent's channel (Docker, `pnpm dev`) there is nothing to listen to.
    if (process.send === undefined) return;
    process.on('message', (message: unknown) => {
      if (message === STOP_MESSAGE) listener();
    });
  },
  onParentGone: (listener) => {
    // A supervisor killed outright (window closed, task ended) leaves no one to stop the API: it stops itself.
    if (process.send === undefined) return;
    process.once('disconnect', listener);
  },
};

/**
 * Listens to `SIGTERM` and `SIGINT` from the first line of an entry point, before anything starts: a signal that
 * arrives while the process starts is kept, and acted on once `stopWith` names what to stop. Until a listener exists,
 * Node lets the signal kill the process at once, without a graceful stop (exit code `null` instead of 0). On the
 * first signal (or the supervisor's stop message, which counts as one), runs `stop` once and exits 0, or 1 if it failed or took longer than `FORCED_EXIT_MS`.
 */
export function exitGracefully(logger: Logger, host: ProcessSignals = NODE_PROCESS): GracefulExit {
  const { exit } = host;
  let stop: (() => Promise<void>) | undefined;
  let signalled = false;
  let isStopping = false;
  const run = (): void => {
    if (isStopping || !signalled || stop === undefined) return;
    isStopping = true;
    stop().then(
      () => {
        logger.info('shutdown complete');
        exit(0);
      },
      (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        exit(1);
      },
    );
  };
  const onSignal = (signal: NodeJS.Signals | 'stop-message' | 'parent-gone'): void => {
    if (signalled) return;
    signalled = true;
    logger.info({ signal }, 'shutting down');
    setTimeout(() => {
      logger.error('shutdown took too long, exiting');
      exit(1);
    }, FORCED_EXIT_MS).unref();
    run();
  };
  host.once('SIGTERM', onSignal);
  host.once('SIGINT', onSignal);
  host.onStopMessage(() => {
    onSignal('stop-message');
  });
  host.onParentGone(() => {
    onSignal('parent-gone');
  });
  return {
    stopWith: (given) => {
      stop ??= given;
      run();
    },
  };
}
