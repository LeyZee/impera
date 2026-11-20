import type { ClientErrorReport } from '@impera/contracts';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import type { ErrorReporter } from '../observability/error-reporter';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * `POST /v1/client-errors` (OPS-18): the dashboard's own errors, signed in only, from its origin, under a limit per
 * account on the shared counters, forwarded to the reporter as they came once their schema passed. Invented data only.
 */
describe('POST /v1/client-errors', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let cookie: string;
  /** Another account, whose refused reports do not count against the first one's limit. */
  let other: string;
  const reported: ClientErrorReport[] = [];
  const reporter: ErrorReporter = {
    isEnabled: true,
    captureException: () => undefined,
    captureClientError: (report) => {
      reported.push(report);
    },
    flush: () => Promise.resolve(),
  };

  const report: ClientErrorReport = {
    message: 'TypeError: cannot read properties of undefined',
    stack:
      'TypeError: cannot read properties of undefined\n    at Draft (https://crm.example.test/assets/index.js:1:2)',
    route: '/equipe/$memberId',
    release: 'abc123',
  };

  const post = (payload: unknown, headers: Record<string, string>) =>
    server.inject({ method: 'POST', url: '/v1/client-errors', headers, payload: JSON.stringify(payload) });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { errorReporter: reporter });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
      // The counters of production (ADR 0027): the route's limit is counted in Postgres.
      rateLimitStore: app.rateLimitStore,
      errorReporter: app.errorReporter,
    });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookie = await signIn(server, 'owner@example.test', PASSWORD);
    await createOwner(app.auth, app.db.db, {
      email: 'other@example.test',
      name: 'Other',
      password: PASSWORD,
    });
    other = await signIn(server, 'other@example.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('refuses a report without a session, or from another site', async () => {
    expect(
      (await post(report, { 'content-type': 'application/json', origin: DASHBOARD_ORIGIN })).statusCode,
    ).toBe(401);
    expect(
      (await post(report, { cookie, 'content-type': 'application/json', origin: 'https://ailleurs.example' }))
        .statusCode,
    ).toBe(403);
    expect(reported).toEqual([]);
  });

  it('refuses a report outside its schema: a long message, an address with its query, a field more', async () => {
    const headers = { cookie: other, origin: DASHBOARD_ORIGIN, 'content-type': 'application/json' };
    expect((await post({ ...report, message: 'x'.repeat(301) }, headers)).statusCode).toBe(400);
    expect((await post({ ...report, stack: 'x'.repeat(4_001) }, headers)).statusCode).toBe(400);
    expect((await post({ ...report, route: '/fans?email=fan@example.test' }, headers)).statusCode).toBe(400);
    expect((await post({ ...report, body: 'the screen’s state' }, headers)).statusCode).toBe(400);
    expect(reported).toEqual([]);
  });

  it('forwards a report and answers 204, then stops at its limit per account', async () => {
    const headers = { cookie, origin: DASHBOARD_ORIGIN, 'content-type': 'application/json' };
    const first = await post(report, headers);
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe('');
    expect(reported).toEqual([report]);
    for (let sent = 1; sent < 12; sent += 1) expect((await post(report, headers)).statusCode).toBe(204);
    const limited = await post(report, headers);
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'client_error_limited' } });
    expect(limited.headers['retry-after']).toBeDefined();
    expect(reported).toHaveLength(12);
  });
});
