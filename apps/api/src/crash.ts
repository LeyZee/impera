import type { Logger } from './logger';

/** What the crash log needs of the process; the tests give their own. */
export interface CrashSource {
  readonly on: (
    event: 'uncaughtExceptionMonitor',
    listener: (error: unknown, origin: string) => void,
  ) => unknown;
}

const NODE_PROCESS: CrashSource = {
  on: (event, listener) => process.on(event, listener),
};

/**
 * Writes an error nobody caught, or a promise nobody awaited, to the structured log before Node kills the process
 * (operations.md). Only a monitor: Node still prints the stack and exits with its failure code, Docker restarts the
 * container and the orphaned locks are released by the next worker. Nothing is stopped gracefully here: after such an
 * error the state of the process is unknown, and carrying on could send or write something twice. The serializer of
 * `err` keeps the name, the code and the stack, never a value (`logger.ts`).
 */
export function logCrashes(logger: Logger, source: CrashSource = NODE_PROCESS): void {
  source.on('uncaughtExceptionMonitor', (error, origin) => {
    logger.fatal({ err: error, origin }, 'process crashed');
  });
}
