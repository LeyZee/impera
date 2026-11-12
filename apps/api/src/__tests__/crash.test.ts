import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { logCrashes, type CrashSource } from '../crash';
import { createLogger } from '../logger';

import { LogSink } from './support/log-sink';

/** A process that only keeps its crash listener, so a test can crash it without dying. */
function fakeProcess(): CrashSource & { readonly crash: (error: unknown, origin: string) => void } {
  let listener: ((error: unknown, origin: string) => void) | undefined;
  return {
    on: (_event, given) => {
      listener = given;
    },
    crash: (error, origin) => listener?.(error, origin),
  };
}

describe('crash log (operations.md)', () => {
  it('writes an uncaught error to the structured log, with where it came from and its stack', () => {
    const sink = new LogSink();
    const host = fakeProcess();
    logCrashes(createLogger({ LOG_LEVEL: 'info' }, sink), host);

    host.crash(new TypeError('boom'), 'unhandledRejection');

    const [line] = sink.withMessage('process crashed');
    expect(line).toMatchObject({ level: 60, origin: 'unhandledRejection', err: { type: 'TypeError' } });
  });

  it('writes a rejection that is not an error as it is', () => {
    const sink = new LogSink();
    const host = fakeProcess();
    logCrashes(createLogger({ LOG_LEVEL: 'info' }, sink), host);

    host.crash('gone', 'unhandledRejection');

    expect(sink.withMessage('process crashed')[0]).toMatchObject({ err: 'gone' });
  });

  it('is told by Node of an uncaught error and of an unhandled rejection, and leaves Node to exit', () => {
    for (const script of ["throw new Error('x')", "Promise.reject(new Error('x'))"]) {
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `process.on('uncaughtExceptionMonitor', (e, origin) => console.log('seen ' + origin)); ${script}`,
        ],
        { encoding: 'utf8' },
      );
      expect(child.stdout).toMatch(/^seen (uncaughtException|unhandledRejection)\n$/);
      expect(child.status).not.toBe(0);
    }
  });
});
