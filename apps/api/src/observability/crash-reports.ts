import type { Logger } from '../logger';

import type { ErrorReporter, ReportedService } from './error-reporter';

/** How long a crash waits for its report to leave before the process exits: short, the state is unknown. */
const CRASH_FLUSH_MS = 2_000;

/** What the crash report needs of the process; the tests give their own. */
export interface FatalSource {
  readonly on: (
    event: 'uncaughtException' | 'unhandledRejection',
    listener: (error: unknown) => void,
  ) => unknown;
  readonly exit: (code: number) => void;
}

const NODE_PROCESS: FatalSource = {
  on: (event, listener) => process.on(event, listener),
  exit: (code) => process.exit(code),
};

/**
 * With Sentry on (OPS-18), an error nobody caught or a promise rejected without a handler is sent before the process
 * exits with 1, as Node would have exited without these listeners. The report gets `CRASH_FLUSH_MS` at most; meanwhile
 * the process is not stopped gracefully either (`crash.ts`). The uncaught error is already in the log through the
 * monitor of `crash.ts`; a rejection, which no longer reaches that monitor once it has a listener, is written here.
 * Without Sentry nothing is listened to and Node keeps its own behaviour.
 */
export function reportCrashes(
  reporter: ErrorReporter,
  logger: Logger,
  service: ReportedService,
  source: FatalSource = NODE_PROCESS,
): void {
  if (!reporter.isEnabled) return;
  let isCrashing = false;
  const crash = (error: unknown): void => {
    if (isCrashing) return;
    isCrashing = true;
    reporter.captureException(error, { service });
    // Whatever the flush does, the process does not outlive it by much.
    const timer = setTimeout(() => {
      source.exit(1);
    }, CRASH_FLUSH_MS + 500).unref();
    const exit = (): void => {
      clearTimeout(timer);
      source.exit(1);
    };
    reporter.flush(CRASH_FLUSH_MS).then(exit, exit);
  };
  source.on('uncaughtException', crash);
  source.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason, origin: 'unhandledRejection' }, 'process crashed');
    crash(reason);
  });
}
