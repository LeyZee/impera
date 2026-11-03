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
}

const NODE_PROCESS: ProcessSignals = {
  once: (signal, listener) => process.once(signal, listener),
  exit: (code) => process.exit(code),
};

/**
 * Listens to `SIGTERM` and `SIGINT` from the first line of an entry point, before anything starts: a signal that
 * arrives while the process starts is kept, and acted on once `stopWith` names what to stop. Until a listener exists,
 * Node lets the signal kill the process at once, without a graceful stop (exit code `null` instead of 0). On the
 * first signal, runs `stop` once and exits 0, or 1 if it failed or took longer than `FORCED_EXIT_MS`.
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
  const onSignal = (signal: NodeJS.Signals): void => {
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
  return {
    stopWith: (given) => {
      stop ??= given;
      run();
    },
  };
}
