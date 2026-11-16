import { describe, expect, it } from 'vitest';

import { createLogger } from '../logger';
import { exitGracefully, type ProcessSignals } from '../shutdown';

import { LogSink } from './support/log-sink';

/** A process that only records: its signal listeners, and the codes it was asked to exit with. */
function fakeProcess(): ProcessSignals & {
  readonly signal: (name: 'SIGTERM' | 'SIGINT') => void;
  readonly askToStop: () => void;
  readonly loseParent: () => void;
  readonly codes: number[];
} {
  const listeners = new Map<string, (signal: NodeJS.Signals) => void>();
  const stopListeners: (() => void)[] = [];
  const goneListeners: (() => void)[] = [];
  const codes: number[] = [];
  return {
    once: (name, listener) => listeners.set(name, listener),
    exit: (code) => codes.push(code),
    onStopMessage: (listener) => stopListeners.push(listener),
    onParentGone: (listener) => goneListeners.push(listener),
    loseParent: () => {
      for (const listener of goneListeners) listener();
    },
    askToStop: () => {
      for (const listener of stopListeners) listener();
    },
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

  it('stops the same way on the supervisor’s stop message, which Windows sends instead of a signal (ADR 0125)', async () => {
    const host = fakeProcess();
    const sink = new LogSink();
    const graceful = exitGracefully(createLogger({ LOG_LEVEL: 'info' }, sink), host);
    const stopped: string[] = [];
    graceful.stopWith(() => {
      stopped.push('server', 'worker');
      return Promise.resolve();
    });
    host.askToStop();
    host.askToStop();
    host.signal('SIGINT');
    await settled();
    expect([stopped, host.codes]).toEqual([['server', 'worker'], [0]]);
    expect(sink.lines[0]).toMatchObject({ msg: 'shutting down', signal: 'stop-message' });
  });

  it('stops the same way when the supervisor dies without asking: its channel closes (ADR 0125)', async () => {
    const host = fakeProcess();
    const sink = new LogSink();
    const graceful = exitGracefully(createLogger({ LOG_LEVEL: 'info' }, sink), host);
    const stopped: string[] = [];
    graceful.stopWith(() => {
      stopped.push('server', 'worker');
      return Promise.resolve();
    });
    host.loseParent();
    await settled();
    expect([stopped, host.codes]).toEqual([['server', 'worker'], [0]]);
    expect(sink.lines[0]).toMatchObject({ msg: 'shutting down', signal: 'parent-gone' });
  });
});
