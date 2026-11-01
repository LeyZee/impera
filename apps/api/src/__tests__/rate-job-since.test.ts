import { createDbClient } from '@nirvana/db';
import { afterAll, describe, expect, it } from 'vitest';

import { rateJobSince } from '../composition-root';

/** A database nobody listens on: any read fails, which a test outside production must never reach. */
const unreachable = createDbClient('postgres://nobody@127.0.0.1:1/none', { connectionTimeoutMillis: 1_000 });

describe('rateJobSince (ADR 0033)', () => {
  afterAll(() => unreachable.close());

  it('gives pay the job’s first schedule in production only: elsewhere a currency without a rate never rings', () => {
    expect(rateJobSince({ NODE_ENV: 'development' }, unreachable.db)).toBeNull();
    expect(rateJobSince({ NODE_ENV: 'test' }, unreachable.db)).toBeNull();
    expect(rateJobSince({ NODE_ENV: 'production' }, unreachable.db)).toBeTypeOf('function');
  });

  it('lets a failed read throw in production, never read as a job that was never scheduled', async () => {
    const since = rateJobSince({ NODE_ENV: 'production' }, unreachable.db);
    expect(since).not.toBeNull();
    await expect(since?.()).rejects.toThrow();
  });
});
