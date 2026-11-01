import { hostname } from 'node:os';

import { eq, schema } from '@nirvana/db';
import { run, type Runner } from 'graphile-worker';

import type { App } from './composition-root';
import { parsedCronJobs, type CronJob } from './crontab';
import { workerLoggerFrom, type Logger } from './logger';
import { useFrenchValidationMessages } from './validation-messages';

export interface WorkerOptions {
  readonly logger: Logger;
  readonly concurrency: number;
  readonly release: string;
  /** Tests pass a shorter interval; production writes every 30 s and `/ready` tolerates 90 s. */
  readonly heartbeatIntervalMs?: number;
  /** Bound on the graceful stop, under Docker's 30 s before `SIGKILL` (operations.md). */
  readonly shutdownTimeoutMs?: number;
  /** Periodic jobs; tests pass none so that only their own jobs execute. */
  readonly cronJobs?: readonly CronJob[];
}

export interface WorkerHandle {
  readonly workerId: string;
  /** Takes no new job, lets the running ones finish (bounded), then removes this worker's heartbeat. */
  stop(): Promise<void>;
}

/**
 * Starts Graphile Worker on the owner pool (it owns the `graphile_worker` schema) with the composition root's
 * tasks. Jobs reach tenant data only through `withTenant` on the application pool, inside each task.
 */
export async function startWorker(app: App, options: WorkerOptions): Promise<WorkerHandle> {
  useFrenchValidationMessages();
  const workerId = `${hostname()}:${String(process.pid)}`;
  const logger = options.logger.child({ workerId });

  const runner: Runner = await run({
    pgPool: app.adminDb.pool,
    taskList: app.tasks,
    parsedCronItems: parsedCronJobs(options.cronJobs),
    concurrency: options.concurrency,
    noHandleSignals: true,
    logger: workerLoggerFrom(logger),
  });

  const beat = async (): Promise<void> => {
    try {
      await app.adminDb.db
        .insert(schema.workerHeartbeats)
        .values({ workerId, hostname: hostname(), version: options.release, lastSeenAt: new Date() })
        .onConflictDoUpdate({
          target: schema.workerHeartbeats.workerId,
          set: { lastSeenAt: new Date(), version: options.release },
        });
    } catch (error) {
      logger.warn({ err: error }, 'heartbeat failed');
    }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), options.heartbeatIntervalMs ?? 30_000);

  logger.info({ concurrency: options.concurrency }, 'worker started');

  let stopping: Promise<void> | undefined;
  const stop = async (): Promise<void> => {
    clearInterval(heartbeat);
    const timeoutMs = options.shutdownTimeoutMs ?? 25_000;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, timeoutMs);
    });
    const outcome = await Promise.race([runner.stop('shutdown').then((): 'stopped' => 'stopped'), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      // The unfinished jobs are released and retried by another worker (locks expire, ADR 0006).
      logger.warn({ timeoutMs }, 'graceful stop timed out, killing the runner');
      await runner.kill('shutdown timeout');
    }
    await app.adminDb.db
      .delete(schema.workerHeartbeats)
      .where(eq(schema.workerHeartbeats.workerId, workerId));
    logger.info('worker stopped');
  };

  return {
    workerId,
    stop: () => (stopping ??= stop()),
  };
}
