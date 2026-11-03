import { Logger as WorkerLogger } from 'graphile-worker';
import { pino, type DestinationStream, type Logger } from 'pino';

import type { Config } from './config';

export type { Logger };

/**
 * Never logged (security.md, coding.md § Logs): credentials, platform sessions, and message content. Paths cover
 * Fastify's request serializer and the objects modules pass as the first argument.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-extension-token"]',
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

/** One structured logger per process, shared by Fastify and Graphile Worker; `destination` is for tests. */
export function createLogger(config: Pick<Config, 'LOG_LEVEL'>, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      base: { service: 'impera-api' },
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
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

/** Routes Graphile Worker's own logs into pino, with its scope (`jobId`, `taskIdentifier`) as fields. */
export function workerLoggerFrom(logger: Logger): WorkerLogger {
  return new WorkerLogger((scope) => (level, message, meta) => {
    logger[WORKER_LEVELS[level]]({ ...scope, ...meta, component: 'graphile-worker' }, message);
  });
}
