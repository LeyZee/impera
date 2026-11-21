import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../logger';
import { retryingPool } from '../worker-pool';

const logger = createLogger({ LOG_LEVEL: 'silent' });

/** Postgres refusing one more connection: what crashed the API with its inline worker (recette CHAT-03). */
const tooMany = (): Error =>
  Object.assign(new Error('remaining connection slots are reserved'), { code: '53300' });

describe('retryingPool (CHAT-03)', () => {
  /** The part of a pool the wrapper changes, and one it leaves. */
  const poolOf = (connect: () => Promise<pg.PoolClient>) => ({ connect, totalCount: 0 });

  it('asks again for a connection Postgres refused for a moment, longer each time, never throwing', async () => {
    const client: pg.PoolClient = Object.assign(new pg.Client(), { release: (): void => undefined });
    const connect = vi
      .fn<() => Promise<pg.PoolClient>>()
      .mockRejectedValueOnce(tooMany())
      .mockRejectedValueOnce(tooMany())
      .mockResolvedValueOnce(client);
    const pool = poolOf(connect);
    const waits: number[] = [];
    const wrapped = retryingPool(pool, logger, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await expect(wrapped.connect()).resolves.toBe(client);
    expect(connect).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([500, 1_000]);
  });

  it('lets any other error go up, and keeps the rest of the pool as it is', async () => {
    const wrong = new Error('password authentication failed');
    const pool = poolOf(() => Promise.reject(wrong));
    const wrapped = retryingPool(pool, logger, { sleep: () => Promise.resolve() });
    await expect(wrapped.connect()).rejects.toBe(wrong);
    expect(wrapped.totalCount).toBe(0);
  });
});
