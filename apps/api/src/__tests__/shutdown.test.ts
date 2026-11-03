import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger';
import { exitGracefully, type ProcessSignals } from '../shutdown';

import { LogSink } from './support/log-sink';

/** A process that only records: its signal listeners, and the codes it was asked to exit with. */
function fakeProcess(): ProcessSignals & {
  readonly signal: (name: 'SIGTERM' | 'SIGINT') => void;
  readonly codes: number[];
} {
  const listeners = new Map<string, (signal: NodeJS.Signals) => void>();
  const codes: number[] = [];
  return {
    once: (name, listener) => listeners.set(name, listener),
    exit: (code) => codes.push(code),
    signal: (name) => {
      const listener = listeners.get(name);
      listeners.delete(name);
      listener?.(name);
    },
    codes,
  };
}

const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('graceful exit (operations.md)', () => {
  it('keeps a SIGTERM that arrives while the process starts, and stops once what it started is given', async () => {
    const host = fakeProcess();
    const sink = new LogSink();
    const graceful = exitGracefully(createLogger({ LOG_LEVEL: 'info' }, sink), host);
    host.signal('SIGTERM');
    await settled();
    expect(host.codes).toEqual([]);
    const stopped: string[] = [];
    graceful.stopWith(() => {
      stopped.push('worker');
      return Promise.resolve();
    });
    await settled();
    expect([stopped, host.codes]).toEqual([['worker'], [0]]);
    expect(sink.lines.map((line) => line.msg)).toEqual(['shutting down', 'shutdown complete']);
  });

  it('stops once, whatever the signals that follow, and exits 1 when the stop fails', async () => {
    const host = fakeProcess();
    const graceful = exitGracefully(createLogger({ LOG_LEVEL: 'silent' }, new LogSink()), host);
    let calls = 0;
    graceful.stopWith(() => {
      calls += 1;
      return Promise.reject(new Error('pool already closed'));
    });
    await settled();
    expect(host.codes).toEqual([]);
    host.signal('SIGTERM');
    host.signal('SIGINT');
    await settled();
    expect([calls, host.codes]).toEqual([1, [1]]);
  });
});
