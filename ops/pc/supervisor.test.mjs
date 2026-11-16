// Tests of ops/pc/supervisor.mjs: restart after a crash, clean stop. Run: pnpm test:scripts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { STOP_MESSAGE, createSupervisor, restartDelay } from './supervisor.mjs';

test('the pause before a restart doubles, up to one minute', () => {
  assert.deepEqual([1, 2, 3, 4, 7, 20].map(restartDelay), [1000, 2000, 4000, 8000, 60_000, 60_000]);
});

/** Children that only record, a clock that moves by hand, timers run on demand. */
function harness() {
  const events = [];
  const processes = [];
  const timers = [];
  let clock = 0;
  const supervisor = createSupervisor({
    children: [
      { name: 'api', ipc: true },
      { name: 'web', ipc: false },
    ],
    spawn: (child) => {
      const listeners = [];
      const process = {
        name: child.name,
        sent: [],
        killed: false,
        onExit: (listener) => listeners.push(listener),
        send: (message) => process.sent.push(message),
        kill: () => {
          process.killed = true;
          process.exit(null);
        },
        exit: (code) => {
          for (const listener of listeners.splice(0)) listener(code);
        },
      };
      processes.push(process);
      return process;
    },
    log: (event, fields = {}) => events.push({ event, ...fields }),
    now: () => clock,
    setTimer: (fn, ms) => timers.push({ fn, ms }),
  });
  return {
    supervisor,
    events,
    processes,
    timers,
    advance: (ms) => {
      clock += ms;
    },
  };
}

test('a crashed child restarts after a pause that grows, then shrinks once it held', () => {
  const { supervisor, processes, timers, advance } = harness();
  supervisor.start();
  assert.equal(processes.length, 2);
  processes[0].exit(1);
  assert.equal(timers.at(-1).ms, 1000);
  timers.at(-1).fn();
  assert.equal(processes.length, 3);
  processes[2].exit(1);
  assert.equal(timers.at(-1).ms, 2000);
  timers.at(-1).fn();
  advance(10 * 60_000);
  processes[3].exit(1);
  assert.equal(timers.at(-1).ms, 1000);
});

test('stops the API with its stop message, the site at once, and restarts nothing', async () => {
  const { supervisor, processes, timers } = harness();
  supervisor.start();
  const [api, web] = processes;
  const stopped = supervisor.stop();
  assert.deepEqual(api.sent, [STOP_MESSAGE]);
  assert.equal(web.killed, true);
  assert.equal(api.killed, false);
  api.exit(0);
  await stopped;
  assert.equal(processes.length, 2);
  assert.ok(timers.every((timer) => timer.ms === 30_000));
});

test('an API that does not drain in time is killed', async () => {
  const { supervisor, processes, timers } = harness();
  supervisor.start();
  const stopped = supervisor.stop();
  timers.find((timer) => timer.ms === 30_000).fn();
  await stopped;
  assert.equal(processes[0].killed, true);
});
