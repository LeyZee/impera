import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

describe('rate_limit_counters (ADR 0027): the shared limiter', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  /** The store's atomic hit: a new window starts at 1, a live one counts on. */
  const hit = (key: string, windowMs: number) =>
    test.app.db.execute<{ hits: number }>(sql`
      insert into rate_limit_counters as c (key, hits, window_ends_at)
      values (${key}, 1, now() + make_interval(secs => ${windowMs / 1000}))
      on conflict (key) do update set
        hits = case when c.window_ends_at <= now() then 1 else c.hits + 1 end,
        window_ends_at = case when c.window_ends_at <= now() then excluded.window_ends_at else c.window_ends_at end
      returning hits`);

  it('is unlogged, and the app role counts, then starts a fresh window once the last one ended', async () => {
    const { rows } = await test.admin.db.execute<{ persistence: string }>(
      sql`select relpersistence as persistence from pg_class where relname = 'rate_limit_counters'`,
    );
    expect(rows).toEqual([{ persistence: 'u' }]);
    expect((await hit('route:hash-a', 60_000)).rows).toEqual([{ hits: 1 }]);
    expect((await hit('route:hash-a', 60_000)).rows).toEqual([{ hits: 2 }]);
    await test.app.db.execute(
      sql`update rate_limit_counters set window_ends_at = now() - interval '1 second'`,
    );
    expect((await hit('route:hash-a', 60_000)).rows).toEqual([{ hits: 1 }]);
    await test.app.db.execute(
      sql`delete from rate_limit_counters where window_ends_at < now() + interval '1 hour'`,
    );
  });

  it('refuses a key over 512 characters and a count below 1', async () => {
    expect(await failure(hit('k'.repeat(513), 60_000))).toMatch(/rate_limit_counters_key_check/);
    expect(
      await failure(
        test.app.db.execute(sql`insert into rate_limit_counters values ('route:hash-b', 0, now())`),
      ),
    ).toMatch(/rate_limit_counters_hits_check/);
  });
});
