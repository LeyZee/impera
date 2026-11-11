import { Logger as WorkerLogger } from 'graphile-worker';
import { pino, type DestinationStream, type Logger } from 'pino';

import type { Config } from './config';
import { postgresCode, storableError, withoutNul } from './database-errors';

export type { Logger };

/**
 * Never logged (security.md, coding.md § Logs): credentials, platform sessions, and message content. Paths cover
 * Fastify's request serializer and the objects modules pass as the first argument.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-extension-link"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
  '*.session',
  '*.sessionCiphertext',
  '*.text',
  '*.body',
];

/** What the logs keep of an error: never its cause chain nor its own fields (a driver's `detail`, Drizzle's `params`). */
interface LoggedError {
  readonly type: string;
  readonly message: string;
  readonly code?: string;
  readonly stack: string;
}

const MAX_CAUSES = 5;

/** The first code in the error's cause chain (`ECONNRESET` under a Drizzle error): a code, never a value. */
function chainCode(error: Error): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSES && current instanceof Error; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = current.cause;
  }
  return undefined;
}

/**
 * The `err` and `error` serializer of every logger, API and worker alike: an error is logged as its name, its message
 * and its code, the frames of its stack after them. A Postgres or Drizzle error carries the query's values in its
 * message, its `params`, its `detail` and its cause, and these values can be a fan's or a creator's (ADR 0010):
 * the message is the one `storableError` keeps (the query without its values, its SQLSTATE), and nothing else is read.
 * A value that is not an error (a name already reduced) is kept as it is.
 */
function loggedError(value: unknown): unknown {
  if (!(value instanceof Error)) return typeof value === 'string' ? withoutNul(value) : value;
  const code = postgresCode(value) ?? chainCode(value);
  const frames = (value.stack ?? '').split('\n').filter((line) => line.startsWith('    at '));
  return {
    type: value.name,
    message: storableError(value).message,
    ...(code === undefined ? {} : { code }),
    stack: frames.join('\n'),
  } satisfies LoggedError;
}

/** One structured logger per process, shared by Fastify and Graphile Worker; `destination` is for tests. */
export function createLogger(config: Pick<Config, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: { service: 'impera-api' },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      serializers: { err: loggedError, error: loggedError },
    },
    destination,
  );
}

const WORKER_LEVELS = {
  error: 'error',
  warning: 'warn',
  info: 'info',
  debug: 'debug',
} as const satisfies Record<'error' | 'warning' | 'info' | 'debug', string>;

/**
 * Graphile puts the whole job in the meta of each task it completes or fails, its payload included, and a payload can
 * carry what a person wrote (the note a chatter leaves on a fan, `conversation.record_facts`): only what places the
 * job is kept. Its last error is already the one `storableError` let through.
 */
function placedJob(job: unknown): unknown {
  if (typeof job !== 'object' || job === null) return job;
  const pick = (key: string): unknown => (key in job ? Reflect.get(job, key) : undefined);
  return {
    id: pick('id'),
    task: pick('task_identifier'),
    attempts: pick('attempts'),
    maxAttempts: pick('max_attempts'),
  };
}

/** Routes Graphile Worker's own logs into pino, with its scope (`jobId`, `taskIdentifier`) as fields. */
export function workerLoggerFrom(logger: Logger): WorkerLogger {
  return new WorkerLogger((scope) => (level, message, meta) => {
    const fields = !('job' in meta) ? meta : { ...meta, job: placedJob(meta['job']) };
    logger[WORKER_LEVELS[level]]({ ...scope, ...fields, component: 'graphile-worker' }, message);
  });
}
