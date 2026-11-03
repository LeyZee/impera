import { JOB_MAX_ATTEMPTS, type JobName, type JobPayload } from '@impera/contracts';
import { makeWorkerUtils, type Task, type WorkerUtils } from 'graphile-worker';
import type { Pool } from 'pg';
import { z } from 'zod';

import type { Logger } from './logger';

/** Payload type of every task the worker knows. */
type TaskPayloads = { readonly [J in JobName]: JobPayload<J> };
type TaskName = keyof TaskPayloads;

interface EnqueueOptions {
  /** Serial queue: `conv:<conversationId>` or `account:<platformAccountId>` (ADR 0006). */
  readonly queueName?: string;
  /** Debounce or dedupe key (`jobKeyFor`); with the default mode a new job replaces the pending one. */
  readonly jobKey?: string;
  readonly jobKeyMode?: 'replace' | 'preserve_run_at';
  readonly runAt?: Date;
  readonly maxAttempts?: number;
}

export interface JobQueue {
  enqueue<T extends TaskName>(
    task: T,
    payload: TaskPayloads[T],
    options?: EnqueueOptions,
  ): Promise<{ jobId: string }>;
  close(): Promise<void>;
}

/**
 * Enqueues through Graphile's own functions on the owner pool, outside any business transaction (ops, tests).
 * A command enqueues in its own transaction instead, through `public.enqueue_job` (ADR 0006).
 */
export async function createJobQueue(adminPool: Pool): Promise<JobQueue> {
  const utils: WorkerUtils = await makeWorkerUtils({ pgPool: adminPool });
  // Graphile manages its own schema (`graphile_worker`); this is idempotent and guarded by an advisory lock.
  await utils.migrate();
  return {
    async enqueue(task, payload, options = {}) {
      // Widened so Graphile does not look the name up in its global task registry; the payload is typed above.
      const identifier: string = task;
      const job = await utils.addJob(identifier, payload, {
        maxAttempts: JOB_MAX_ATTEMPTS[task],
        ...options,
      });
      return { jobId: job.id };
    },
    async close() {
      await utils.release();
    },
  };
}

export interface TaskContext {
  readonly logger: Logger;
  readonly jobId: string;
  readonly attempt: number;
}

const CorrelationSchema = z.object({ correlationId: z.string() });

/**
 * Wraps a handler as a Graphile task: the payload is validated by its contract schema (a job is a boundary,
 * CLAUDE.md rule 6) and the handler gets a logger carrying `jobId`, `task` and the request's `correlationId`.
 * A payload that does not validate fails the job; Graphile keeps it with its error for inspection.
 */
export function defineTask<S extends z.ZodType>(
  name: string,
  schema: S,
  logger: Logger,
  handler: (payload: z.output<S>, context: TaskContext) => Promise<void>,
): Task {
  return async (rawPayload, helpers) => {
    const correlation = CorrelationSchema.safeParse(rawPayload);
    const jobLogger = logger.child({
      task: name,
      jobId: helpers.job.id,
      ...(correlation.success ? { correlationId: correlation.data.correlationId } : {}),
    });
    const parsed = schema.safeParse(rawPayload);
    if (!parsed.success) {
      jobLogger.error(
        { issues: parsed.error.issues.map((issue) => issue.path.join('.')) },
        'invalid job payload',
      );
      throw new Error(`Invalid payload for ${name}`);
    }
    await handler(parsed.data, { logger: jobLogger, jobId: helpers.job.id, attempt: helpers.job.attempts });
  };
}
