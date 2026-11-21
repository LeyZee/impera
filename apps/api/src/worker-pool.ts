import type { Pool, PoolClient } from 'pg';

import { isDatabaseUnavailable } from './database-errors';
import type { Logger } from './logger';

const FIRST_DELAY_MS = 500;
const LONGEST_DELAY_MS = 30_000;

export interface RetryOptions {
  /** Tests wait for nothing. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The service pool as Graphile Worker sees it: a connection Postgres refuses for a moment (too many connections, a
 * restart) is logged and asked again, longer each time, never thrown. Graphile does not wait on the call that marks a
 * job failed: its refusal would be a promise nobody awaits, and Node would stop the whole process, the API with it
 * when the worker runs inline (recette CHAT-03). Any other error goes up as before. Everything else is the pool itself.
 */
export function retryingPool<P extends Pick<Pool, 'connect'>>(
  pool: P,
  logger: Logger,
  options: RetryOptions = {},
): P {
  const sleep = options.sleep ?? pause;
  const connect = async (): Promise<PoolClient> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await pool.connect();
      } catch (error) {
        if (!isDatabaseUnavailable(error)) throw error;
        const delayMs = Math.min(LONGEST_DELAY_MS, FIRST_DELAY_MS * 2 ** attempt);
        logger.warn({ err: error, attempt: attempt + 1, delayMs }, 'worker: database unavailable, retrying');
        await sleep(delayMs);
      }
    }
  };
  return new Proxy(pool, {
    get(target, property) {
      if (property === 'connect') return connect;
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      const bound: unknown = value.bind(target);
      return bound;
    },
  });
}
