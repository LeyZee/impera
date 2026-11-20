import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger';
import { reportCrashes, type FatalSource } from '../observability/crash-reports';
import { INERT_ERROR_REPORTER, type ErrorReporter, type ReportPlace } from '../observability/error-reporter';

type Listener = (error: unknown) => void;

/** A process that keeps its listeners and its exit codes, and a reporter that keeps what it was given. */
function fixture(enabled = true) {
  const listeners = new Map<string, Listener>();
  const exits: number[] = [];
  const captured: { readonly error: unknown; readonly place: ReportPlace }[] = [];
  let flushes = 0;
  const source: FatalSource = {
    on: (event, listener) => listeners.set(event, listener),
    exit: (code) => {
      exits.push(code);
    },
  };
  const reporter: ErrorReporter = enabled
    ? {
        isEnabled: true,
        captureException: (error, place) => {
          captured.push({ error, place });
        },
        captureClientError: () => undefined,
        flush: () => {
          flushes += 1;
          return Promise.resolve();
        },
      }
    : INERT_ERROR_REPORTER;
  const lines: string[] = [];
  const logger = createLogger(
    { LOG_LEVEL: 'info' },
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        lines.push(chunk.toString());
        done();
      },
    }),
  );
  return { listeners, exits, captured, flushes: () => flushes, source, reporter, logger, lines };
}

describe('reportCrashes (OPS-18)', () => {
  it('listens to nothing without Sentry: Node keeps its own behaviour', () => {
    const { listeners, source, reporter, logger } = fixture(false);
    reportCrashes(reporter, logger, 'api', source);
    expect(listeners.size).toBe(0);
  });

  it('sends an uncaught error, waits for it to leave, then exits with 1, once', async () => {
    const { listeners, exits, captured, flushes, source, reporter, logger } = fixture();
    reportCrashes(reporter, logger, 'worker', source);
    const error = new Error('boom');
    listeners.get('uncaughtException')?.(error);
    listeners.get('uncaughtException')?.(new Error('again'));
    await Promise.resolve();
    expect(captured).toEqual([{ error, place: { service: 'worker' } }]);
    expect(flushes()).toBe(1);
    expect(exits).toEqual([1]);
  });

  it('writes a rejection nobody handled to the log, sends it, and exits with 1', async () => {
    const { listeners, exits, captured, source, reporter, logger, lines } = fixture();
    reportCrashes(reporter, logger, 'api', source);
    listeners.get('unhandledRejection')?.(new Error('nobody awaited'));
    await Promise.resolve();
    expect(captured).toHaveLength(1);
    expect(exits).toEqual([1]);
    expect(lines.join('')).toContain('"origin":"unhandledRejection"');
    expect(lines.join('')).toContain('process crashed');
  });
});
