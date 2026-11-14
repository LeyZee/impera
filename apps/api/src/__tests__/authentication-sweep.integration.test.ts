import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { MethodSchema, namesOf, routesOf } from './support/routes';
import { DASHBOARD_ORIGIN } from './support/sign-in';

/**
 * Every route of the API, asked without a session (audit des tests d'isolation, 06/11): it answers 401, but for the
 * routes listed here, each with why it opens without one. The routes are read from the server, so a route added
 * tomorrow without its guard fails this test until it gets one or is listed. Any answer but 401 is reported, a 400 or a
 * 404 too: a check that runs before the guard already answers without a session (relecture #595).
 */
const PUBLIC: Readonly<Record<string, string>> = {
  'GET /health': 'liveness, for the host and the uptime check',
  'GET /ready': 'readiness, for the host: counts only',
  'GET /v1/session': 'says whether a session exists, null without one',
  'GET /v1/auth/passkey/generate-authenticate-options': 'first step of a passkey sign-in',
  'POST /v1/auth/passkey/verify-authentication': 'second step of a passkey sign-in',
  'POST /v1/auth/sign-in/email': 'sign-in, under its own limiters',
  'POST /v1/auth/sign-out': 'ends a session, if any',
  'POST /v1/auth/two-factor/verify-totp': 'second factor, under the sign-in cookie',
  'POST /v1/auth/two-factor/verify-backup-code': 'second factor, under the sign-in cookie',
  'POST /v1/auth/password-reset': 'asks for a reset link, says the same whoever asks',
  'POST /v1/auth/password-reset/inspect': 'reads a reset link by its token',
  'POST /v1/auth/password-reset/redeem': 'uses a reset link by its token',
  'POST /v1/invitation-links/inspect': 'reads an invitation by its token',
  'POST /v1/invitation-links/redeem': 'uses an invitation by its token',
  'GET /v1/calendar-feed/:file': 'a calendar feed, by its secret token',
  'POST /v1/webhooks/sales-feeds/:platform': 'the platform’s webhook, checked by its signature',
};

/** A value for each path parameter: none is looked up, the guard answers first. */
const filler = (name: string): string =>
  name === 'day' ? '2026-11-06' : name === 'period' ? '2026-11-01' : '00000000-0000-4000-8000-000000000000';

describe('no route answers without a session, but those said (audit des tests d’isolation, 06/11)', () => {
  let test: TestDb;
  let server: Server;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    const app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
  });

  afterAll(async () => {
    await server.close();
    await test.close();
  });

  it('answers 401 to every route asked without a session, but the public ones', async () => {
    const routes = routesOf(server.printRoutes({ commonPrefix: false }));
    // A wildcard has no single path to ask: one that comes is swept by a concrete path, not skipped (relecture #595).
    expect(routes.filter((r) => r.path.includes('*'))).toEqual([]);
    expect(routes.length).toBeGreaterThan(200);
    const open: string[] = [];
    for (const [index, route] of routes.entries()) {
      const url = route.path
        .split('/')
        .map((segment) => {
          const [name] = namesOf(segment);
          return name === undefined ? segment : filler(name);
        })
        .join('/');
      const writes = route.method === 'POST' || route.method === 'PUT' || route.method === 'PATCH';
      const response = await server.inject({
        method: MethodSchema.parse(route.method),
        url,
        headers: { origin: DASHBOARD_ORIGIN },
        // One address per request: the limiter counts by address, and a 429 would hide what the route answers.
        remoteAddress: `10.1.${String(Math.floor(index / 250))}.${String(index % 250)}`,
        ...(writes && { payload: {} }),
      });
      if (response.statusCode !== 401)
        open.push(`${route.method} ${route.path} → ${String(response.statusCode)}`);
    }
    const key = (finding: string) => finding.replace(/ → \d+$/u, '');
    expect(open.map(key).sort()).toEqual(Object.keys(PUBLIC).sort());
  });
});
