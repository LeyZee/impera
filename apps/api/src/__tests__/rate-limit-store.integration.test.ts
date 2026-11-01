import { createDbClient, sql, type DbClient } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { postgresRateLimitStore, purgeRateLimitCounters, RATE_LIMIT_POOL_OPTIONS } from '../rate-limit-store';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN } from './support/sign-in';

const PER_MINUTE = 4;

/**
 * The limiter's pool for the tests that count: its production bounds (`RATE_LIMIT_POOL_OPTIONS`, 500 ms to connect,
 * 200 ms per statement) let a request through uncounted on a cold, busy CI runner, and a count one short reads as
 * a missing 429. Giving up when Postgres is slow is tested below, on the production pool.
 */
const COUNTING_POOL_OPTIONS = {
  ...RATE_LIMIT_POOL_OPTIONS,
  connectionTimeoutMillis: 10_000,
  options: '-c statement_timeout=10000',
};

describe('rate limits shared by every API instance (ADR 0027)', () => {
  let test: TestDb;
  let app: App;
  let first: Server;
  let second: Server;
  let countingDb: DbClient;
  let config: ReturnType<typeof testConfig>;

  const me = (server: Server, remoteAddress: string) =>
    server.inject({ method: 'GET', url: '/v1/me', remoteAddress });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      RATE_LIMIT_PER_MINUTE: String(PER_MINUTE),
    });
    app = await createApp(config, createLogger(config));
    countingDb = createDbClient(test.appUrl, COUNTING_POOL_OPTIONS);
    // Two instances of the API, as two containers behind the proxy: same routes, same store, no shared memory.
    const instance = () =>
      buildServer({
        config,
        logger: createLogger(config),
        routes: app.routes,
        readiness: app.readiness,
        rateLimitStore: postgresRateLimitStore({ db: countingDb.db, logger: createLogger(config) }),
      });
    first = await instance();
    second = await instance();
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: 'correct horse battery',
    });
  });

  beforeEach(async () => {
    await test.admin.db.execute(sql`delete from rate_limit_counters`);
  });

  afterAll(async () => {
    await first.close();
    await second.close();
    await countingDb.close();
    await app.shutdown();
    await test.close();
  });

  it('counts one client across both instances, and the limit does not double', async () => {
    for (let i = 0; i < PER_MINUTE; i += 1) {
      const response = await me(i % 2 === 0 ? first : second, '192.0.2.1');
      expect(response.statusCode).toBe(401);
    }
    const limited = await me(first, '192.0.2.1');
    expect(limited.statusCode).toBe(429);
    expect(limited.json<{ error: { code: string } }>().error.code).toBe('rate_limited');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await me(second, '192.0.2.1')).statusCode).toBe(429);

    expect((await me(second, '192.0.2.2')).statusCode).toBe(401);
  });

  it('starts a client again at one once its window has ended', async () => {
    for (let i = 0; i <= PER_MINUTE; i += 1) await me(first, '192.0.2.3');
    expect((await me(first, '192.0.2.3')).statusCode).toBe(429);

    await test.admin.db.execute(
      sql`update rate_limit_counters set window_ends_at = now() - interval '1 second'`,
    );
    const again = await me(second, '192.0.2.3');
    expect(again.statusCode).toBe(401);
    expect(again.headers['x-ratelimit-remaining']).toBe(String(PER_MINUTE - 1));
  });

  it('keeps a limiter of its own apart from the API-wide one (sign-ins per account)', async () => {
    const signIn = (server: Server, remoteAddress: string) =>
      server.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/email',
        payload: { email: 'target@example.test', password: 'wrong password!' },
        remoteAddress,
        headers: { origin: DASHBOARD_ORIGIN },
      });
    // Ten tries per account, from addresses that each stay under the API-wide limit, split across both instances.
    for (let i = 0; i < 10; i += 1) {
      expect((await signIn(i % 2 === 0 ? first : second, `198.51.100.${String(i)}`)).statusCode).toBe(401);
    }
    const blocked = await signIn(second, '198.51.100.50');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json<{ error: { code: string } }>().error.code).toBe('sign_in_limited');
  });

  it('stores neither an IP nor an e-mail in clear', async () => {
    await me(first, '203.0.113.9');
    const { rows } = await test.admin.db.execute<{ key: string }>(sql`select key from rate_limit_counters`);
    expect(rows.length).toBeGreaterThan(0);
    for (const { key } of rows) {
      expect(key).not.toContain('203.0.113.9');
      expect(key).not.toContain('@');
    }
  });

  it('purges the counters whose window ended over an hour ago, and only those', async () => {
    await test.admin.db.execute(
      sql`insert into rate_limit_counters (key, hits, window_ends_at) values
          ('old', 3, now() - interval '2 hours'), ('recent', 1, now() - interval '5 minutes'), ('live', 1, now() + interval '1 minute')`,
    );
    expect(await purgeRateLimitCounters(app.db.db)).toBe(1);
    const { rows } = await test.admin.db.execute<{ key: string }>(
      sql`select key from rate_limit_counters order by key`,
    );
    expect(rows.map((row) => row.key)).toEqual(['live', 'recent']);
  });
  describe('when the counters cannot be read', () => {
    const signIn = (server: Server) =>
      server.inject({
        method: 'POST',
        url: '/v1/auth/sign-in/email',
        payload: { email: 'owner@example.test', password: 'correct horse battery' },
        remoteAddress: '192.0.2.80',
        headers: { origin: DASHBOARD_ORIGIN },
      });

    const serverOn = (store: App['rateLimitStore']) =>
      buildServer({
        config,
        logger: createLogger(config),
        routes: app.routes,
        readiness: app.readiness,
        rateLimitStore: store,
      });

    /** What the store logs: the limiter of each failure, never the client's key. */
    const warnings: unknown[] = [];
    const logger = { warn: (object: unknown) => void warnings.push(object) };
    beforeEach(() => {
      warnings.length = 0;
    });

    const brokenStore = postgresRateLimitStore({
      db: { execute: () => Promise.reject(new Error('connection refused')) },
      logger,
    });

    it('lets an ordinary request through, and logs why (fail-open)', async () => {
      const server = await serverOn(brokenStore);
      try {
        const response = await me(server, '192.0.2.70');
        expect(response.statusCode).toBe(401);
        expect(warnings).toEqual([expect.objectContaining({ limiter: 'global' })]);
      } finally {
        await server.close();
      }
    });

    it('refuses a sign-in with a 503 (fail-closed)', async () => {
      const server = await serverOn(brokenStore);
      try {
        const refused = await signIn(server);
        expect(refused.statusCode).toBe(503);
        expect(refused.json<{ error: { code: string } }>().error.code).toBe('service_unavailable');
        expect(warnings).toEqual([expect.objectContaining({ limiter: 'route POST /v1/auth/sign-in/email' })]);
      } finally {
        await server.close();
      }
    });

    describe('because Postgres is too slow', () => {
      let limiterDb: DbClient;
      let server: Server;

      beforeAll(async () => {
        // The pool the composition root gives the limiter, on the test database.
        limiterDb = createDbClient(test.appUrl, RATE_LIMIT_POOL_OPTIONS);
        server = await serverOn(postgresRateLimitStore({ db: limiterDb.db, logger }));
      });

      afterAll(async () => {
        await server.close();
        await limiterDb.close();
      });

      /** Runs `fn` while another session holds the counters table, as a stuck transaction would. */
      async function whileLocked<T>(fn: () => Promise<T>): Promise<T> {
        const holder = await test.admin.pool.connect();
        try {
          await holder.query('begin');
          await holder.query('lock table rate_limit_counters in access exclusive mode');
          return await fn();
        } finally {
          await holder.query('rollback');
          holder.release();
        }
      }

      it('gives up after the statement timeout: an ordinary request passes, a sign-in is refused', async () => {
        await whileLocked(async () => {
          const started = Date.now();
          expect((await me(server, '192.0.2.90')).statusCode).toBe(401);
          expect((await signIn(server)).statusCode).toBe(503);
          // Two requests, each held at most the 200 ms timeout (plus the round trips), never a pool's 5 s.
          expect(Date.now() - started).toBeLessThan(2_000);
        });
        expect(warnings).toHaveLength(2);
      });
    });
  });
});
