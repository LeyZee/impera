import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp, type App } from '../composition-root';
import type { Config } from '../config';
import { createLogger } from '../logger';
import { startWorker } from '../worker-runner';

import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { createSlowTask, enqueueSlow, SLOW_TASK } from './support/slow-task';

const API_ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('graceful shutdown (operations.md)', () => {
  let test: TestDb;
  let app: App;
  let config: Config;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
  });

  afterAll(async () => {
    await app.shutdown();
    await test.close();
  });

  it('lets the running job finish when the worker stops', async () => {
    const sink = new LogSink();
    const logger = createLogger({ LOG_LEVEL: 'info' }, sink);
    const worker = await startWorker(
      { ...app, tasks: { [SLOW_TASK]: createSlowTask(logger) } },
      {
        logger,
        concurrency: 1,
        release: 'test',
        cronJobs: [],
      },
    );
    await enqueueSlow(test.admin.db, 1, 1_500, 'conv:z');
    await sink.waitFor('slow started');
    await worker.stop();
    expect(sink.withMessage('slow finished')).toHaveLength(1);
  });

  // Windows has no SIGTERM: `kill` ends the process at once, so the graceful path only exists on Linux and macOS.
  it.skipIf(process.platform === 'win32')('stops on SIGTERM and exits with code 0', async () => {
    // Node with tsx's loader rather than `node_modules/.bin/tsx`, a shell script that `spawn` cannot run on Windows.
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker.ts'], {
      cwd: API_ROOT,
      env: {
        PATH: process.env['PATH'],
        LOG_LEVEL: 'info',
        DATABASE_URL: test.appUrl,
        DATABASE_ADMIN_URL: test.adminUrl,
        WEB_ORIGIN: config.WEB_ORIGIN,
        AUTH_SECRET: config.AUTH_SECRET,
        AUTH_BASE_URL: config.AUTH_BASE_URL,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = new LogSink();
    child.stdout.on('data', (chunk: Buffer) => {
      output.collect(chunk.toString());
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number | null>((resolve) =>
      child.once('exit', (code) => {
        resolve(code);
      }),
    );

    await output.waitFor('worker started', 1, 20_000).catch((error: unknown) => {
      throw new Error(`worker did not start: ${stderr}`, { cause: error });
    });
    child.kill('SIGTERM');

    expect(await exited, stderr).toBe(0);
    expect(output.lines.map((line) => line.msg)).toContain('shutdown complete');
  });
});
