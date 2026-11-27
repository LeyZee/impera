import { isDatabaseUnavailable } from '../database-errors';
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
 *
 * One rejection never stops the process, Sentry or not: the database out of reach for a moment (a connection refused,
 * timed out or cut). Graphile Worker does not await the call that marks a job done or failed, so such a moment became
 * a rejection nobody handled, and the API stopped with its inline worker (recette CHAT-03, COUV-14). Nothing of the
 * process is left half-done by it: the pool drops the broken connection, and the job, still locked, is run again once
 * its lock is released (jobs are idempotent, ADR 0006). It is logged and sent, and the process goes on. Without Sentry,
 * any other rejection still stops the process with 1, as Node would.
 */
export function reportCrashes(
  reporter: ErrorReporter,
  logger: Logger,
  service: ReportedService,
  source: FatalSource = NODE_PROCESS,
): void {
  if (!reporter.isEnabled) {
    source.on('unhandledRejection', (reason) => {
      if (keptAlive(reason, reporter, logger, service)) return;
      logger.fatal({ err: reason, origin: 'unhandledRejection' }, 'process crashed');
      source.exit(1);
    });
    return;
  }
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
    if (keptAlive(reason, reporter, logger, service)) return;
    logger.fatal({ err: reason, origin: 'unhandledRejection' }, 'process crashed');
    crash(reason);
  });
}

/** The database out of reach for a moment: logged and sent, and the process goes on (recette CHAT-03, COUV-14). */
function keptAlive(
  reason: unknown,
  reporter: ErrorReporter,
  logger: Logger,
  service: ReportedService,
): boolean {
  if (!isDatabaseUnavailable(reason)) return false;
  logger.error({ err: reason, origin: 'unhandledRejection' }, 'database unavailable, process kept');
  if (reporter.isEnabled) reporter.captureException(reason, { service });
  return true;
}
